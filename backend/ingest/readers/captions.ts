import { transcriptBlocks, type Cue } from '../../core/links';
import type { ReadResult } from '../types';

const TIMING = /^((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3}(?:\s|$)/;
const START = /^(?:(\d+):)?(\d{1,2}):(\d{2})/;
const TAGS = /<\/?[a-zA-Z][^>]*>|<\d{1,2}:\d{2}(?:[:.]\d+)*>|\{\\[^}]*\}/g;
const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'" };
const NON_CUE_BLOCK = /^(?:NOTE|STYLE|REGION)(?:\s|$)/;

/** The whole seconds of a time such as "01:02:05.250" or "02:05,250" (hours are optional). */
function secondsOf(stamp: string): number {
  const m = START.exec(stamp) as RegExpExecArray;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** One line of speech without markup: tags, inline word timings and override codes removed, entities decoded. */
function cleanLine(line: string): string {
  const plain = line.replace(TAGS, '').replace(/&(?:lt|gt|nbsp|quot|#39);/g, (e) => ENTITIES[e] as string).replace(/&amp;/g, '&');
  return plain.replace(/\s+/g, ' ').trim();
}

/**
 * The lines of a file cut into blocks at its blank lines. A line of only spaces right after a timing
 * line is not a break: automatic captions put one there, ahead of the words.
 */
function blocksOf(text: string): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  let lastWasTiming = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    const spaceAfterTiming = lastWasTiming && raw !== '' && !line;
    if (line || spaceAfterTiming) current.push(line);
    else if (current.length) {
      blocks.push(current);
      current = [];
    }
    lastWasTiming = TIMING.test(line);
  }
  if (current.length) blocks.push(current);
  return blocks;
}

/** The start time and the cleaned text lines of one block, or null when it is not a cue (a note, a header, a broken timing line). */
function cueOf(block: string[]): { seconds: number; lines: string[] } | null {
  if (NON_CUE_BLOCK.test(block[0] as string) || (block[0] as string).startsWith('WEBVTT')) return null;
  // a cue may have an index or an identifier before its timing line
  const at = block.slice(0, 2).findIndex((line) => TIMING.test(line));
  if (at < 0) return null;
  const timing = TIMING.exec(block[at] as string) as RegExpExecArray;
  const lines = block.slice(at + 1).map(cleanLine).filter(Boolean);
  return { seconds: secondsOf(timing[1] as string), lines };
}

/** How many of the first lines of a cue are the lines just kept (rolling captions repeat them). */
function repeatedLines(kept: string[], lines: string[]): number {
  for (let n = Math.min(lines.length, kept.length); n > 0; n--) {
    if (lines.slice(0, n).every((line, i) => line === kept[kept.length - n + i])) return n;
  }
  return 0;
}

/**
 * The cues of an .srt or .vtt file: each with its start in whole seconds and its lines joined by
 * spaces. Lines that only repeat the ones just before (the rolling lines of automatic captions) are
 * left out, and so are cues with nothing left. Null when the text holds no cue.
 */
export function parseCaptions(text: string): Cue[] | null {
  const cues: Cue[] = [];
  const kept: string[] = [];
  for (const block of blocksOf(text)) {
    const cue = cueOf(block);
    if (!cue) continue;
    const fresh = cue.lines.slice(repeatedLines(kept, cue.lines));
    if (fresh.length === 0) continue;
    kept.push(...fresh);
    cues.push({ seconds: cue.seconds, text: fresh.join(' ') });
  }
  return cues.length ? cues : null;
}

/** A caption file as parts of about a minute of speech, named by where in the video they start. */
export function readCaptions(text: string, fallbackTitle: string): ReadResult {
  const cues = parseCaptions(text);
  return { title: fallbackTitle, blocks: cues ? transcriptBlocks(cues) : [] };
}
