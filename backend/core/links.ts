/**
 * Links and transcripts (design §7): what an address the learner gives points at, and a video
 * transcript pasted from its page turned into parts by the minute. Pure.
 */

/** A web page (or a document) by its address, or a video whose transcript the learner pastes. */
export type Link = { kind: 'page'; url: string } | { kind: 'video'; url: string; videoId: string };

const VIDEO_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function videoIdOf(url: URL): string | null {
  const segments = url.pathname.split('/').filter(Boolean);
  let id: string | null | undefined = null;
  if (url.hostname === 'youtu.be') id = segments[0];
  else if (VIDEO_HOSTS.has(url.hostname)) id = segments[0] === 'watch' ? url.searchParams.get('v') : ['shorts', 'embed', 'live', 'v'].includes(segments[0] ?? '') ? segments[1] : null;
  return id && VIDEO_ID.test(id) ? id : null;
}

/**
 * Read an address as the learner typed it: "https://" may be left off; only web addresses count.
 * Every way of writing one video is the same link, and a page's "#part" is dropped, so the same thing
 * is never added twice.
 */
export function parseLink(input: string): Link | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // "mailto:someone@example.org" reads as a name and a password for a site: not an address to open
  if (url.username || url.password) return null;
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
  const videoId = videoIdOf(url);
  if (videoId) return { kind: 'video', url: `https://www.youtube.com/watch?v=${videoId}`, videoId };
  url.hash = '';
  return { kind: 'page', url: url.href };
}

/** One line of a transcript: when it is said, and what. */
export interface Cue {
  seconds: number;
  text: string;
}

const STAMP = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/;
const STAMPED_LINE = /^((?:\d{1,2}:)?\d{1,2}:\d{2})\s+(\S.*)$/;
const MIN_CUES = 4;

function secondsOf(stamp: string): number | null {
  const m = STAMP.exec(stamp);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** "1:02:05" for a place in a video. */
export function timestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

/** A line that only spells out its time stamp ("1 minute, 23 seconds", in any language): the page adds it for screen readers. */
function spellsOut(line: string, seconds: number): boolean {
  if (line.length > 48 || !/^[\d\p{L}\s,.]+$/u.test(line)) return false;
  const numbers = (line.match(/\d+/g) ?? []).map(Number);
  if (numbers.length === 0 || numbers.length > 3) return false;
  const parts = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60];
  const spoken = parts.filter((p, i) => p > 0 || (i === 2 && seconds === 0));
  return numbers.length === spoken.length && numbers.every((n, i) => n === spoken[i]);
}

/**
 * The cues of a transcript copied from a video's page: a time stamp on its own line (or at the start
 * of a line), then what is said. Null when the text is not a transcript: too few stamps, stamps that
 * do not run forward, or mostly lines without one.
 */
export function transcriptCues(text: string): Cue[] | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const cues: Cue[] = [];
  let current: Cue | null = null;
  let stamps = 0;
  let fresh = false;
  for (const line of lines) {
    const alone = secondsOf(line);
    const withText = alone === null ? STAMPED_LINE.exec(line) : null;
    const start = alone ?? (withText ? secondsOf(withText[1] as string) : null);
    if (start !== null) {
      stamps += 1;
      current = { seconds: start, text: withText ? (withText[2] as string) : '' };
      cues.push(current);
      fresh = alone !== null;
    } else if (current) {
      if (fresh && spellsOut(line, current.seconds)) {
        fresh = false;
        continue;
      }
      fresh = false;
      current.text = current.text ? `${current.text} ${line}` : line;
    }
  }
  const spoken = cues.filter((c) => c.text);
  if (spoken.length < MIN_CUES || stamps < lines.length * 0.3) return null;
  const forward = spoken.filter((c, i) => i === 0 || c.seconds >= (spoken[i - 1] as Cue).seconds).length;
  return forward >= spoken.length * 0.9 ? spoken : null;
}

/** A transcript as parts of about a minute each, named by where in the video they start. */
export function transcriptBlocks(cues: Cue[], windowSeconds = 60): { text: string; locator: string }[] {
  const blocks: { text: string; locator: string; start: number }[] = [];
  for (const cue of cues) {
    const last = blocks[blocks.length - 1];
    if (last && cue.seconds >= last.start && cue.seconds - last.start < windowSeconds) last.text += ` ${cue.text}`;
    else blocks.push({ text: cue.text, locator: timestamp(cue.seconds), start: cue.seconds });
  }
  return blocks.map(({ text, locator }) => ({ text, locator }));
}
