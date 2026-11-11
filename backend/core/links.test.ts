import { describe, expect, it } from 'vitest';
import { parseLink, timestamp, transcriptBlocks, transcriptCues } from './links';

describe('links', () => {
  it('reads a web address as typed, with or without https', () => {
    expect(parseLink(' https://example.org/notes/week-2#part-3 ')).toEqual({ kind: 'page', url: 'https://example.org/notes/week-2' });
    expect(parseLink('example.org/a?page=2')).toEqual({ kind: 'page', url: 'https://example.org/a?page=2' });
    expect(parseLink('http://localhost:8000/notes.html')).toEqual({ kind: 'page', url: 'http://localhost:8000/notes.html' });
  });

  it('turns away what is not a web address', () => {
    for (const bad of ['', 'two words', 'file:///etc/passwd', 'javascript://x', 'mailto:someone@example.org', 'notes']) expect(parseLink(bad)).toBeNull();
  });

  it('sees every way of writing one video as the same link', () => {
    const same = { kind: 'video', url: 'https://www.youtube.com/watch?v=aircAruvnKk', videoId: 'aircAruvnKk' };
    for (const address of [
      'https://www.youtube.com/watch?v=aircAruvnKk&t=120s',
      'youtu.be/aircAruvnKk?si=abc',
      'https://m.youtube.com/watch?list=PL1&v=aircAruvnKk',
      'https://www.youtube.com/embed/aircAruvnKk',
      'https://www.youtube.com/shorts/aircAruvnKk',
      'https://www.youtube.com/live/aircAruvnKk',
    ]) {
      expect(parseLink(address)).toEqual(same);
    }
    // a channel or a search page is a page like any other
    expect(parseLink('https://www.youtube.com/results?search_query=nash')?.kind).toBe('page');
  });
});

const COPIED = `Intro
0:00
this is a three
0:04
sloppily written and rendered
0:58
at a low resolution
1:02
but your brain has no trouble
Chapter two
1:02:15
recognizing it as a three`;

describe('transcripts', () => {
  it('writes a place in a video the way a player shows it', () => {
    expect(timestamp(0)).toBe('0:00');
    expect(timestamp(75)).toBe('1:15');
    expect(timestamp(3735)).toBe('1:02:15');
  });

  it('reads a transcript copied from a video page: a time stamp, then what is said', () => {
    const cues = transcriptCues(COPIED);
    expect(cues?.map((c) => c.seconds)).toEqual([0, 4, 58, 62, 3735]);
    // a chapter title between two lines stays with the line before it
    expect(cues?.[3]?.text).toBe('but your brain has no trouble Chapter two');
    expect(cues?.[4]?.text).toBe('recognizing it as a three');
  });

  it('reads stamps at the start of a line, and drops the spelled-out stamp a page adds for screen readers', () => {
    const inline = transcriptCues('0:00 one\n0:05 two\n0:10 three\n0:15 four');
    expect(inline?.map((c) => c.text)).toEqual(['one', 'two', 'three', 'four']);
    const spoken = transcriptCues('0:00\n0 Sekunden\nerstens\n0:05\n5 Sekunden\n3 Spieler wählen\n1:05\n1 Minute, 5 Sekunden\ndrittens\n1:10\n1 minute, 10 seconds\nviertens');
    expect(spoken?.map((c) => c.text)).toEqual(['erstens', '3 Spieler wählen', 'drittens', 'viertens']);
  });

  it('does not take ordinary text for a transcript', () => {
    expect(transcriptCues('# Notes\n\nThe meeting is at 10:30 and ends at 11:00.\n\nBring the slides.')).toBeNull();
    expect(transcriptCues('0:00\none\n0:05\ntwo')).toBeNull(); // too short to tell
    expect(transcriptCues('9:00\na\n3:00\nb\n7:00\nc\n1:00\nd\n0:30\ne')).toBeNull(); // times that do not run forward: a schedule, not a video
  });

  it('keeps a transcript by the minute, each part named by where it starts', () => {
    const blocks = transcriptBlocks(transcriptCues(COPIED) ?? []);
    expect(blocks.map((b) => b.locator)).toEqual(['0:00', '1:02', '1:02:15']);
    expect(blocks[0]?.text).toBe('this is a three sloppily written and rendered at a low resolution');
  });
});
