import { describe, expect, it } from 'vitest';
import { nothingToRead } from '../../services/ingestion';
import { kindForFile, readBytes } from './index';
import { parseCaptions, readCaptions } from './captions';

const SRT = `1
00:00:01,500 --> 00:00:04,000
Welcome to the <i>lecture</i>.
Today: {\\an8}game theory.

2
00:00:30,000 --> 00:00:33,250
A <b>strategy</b> is a plan &amp; more.

3
00:01:02,500 --> 00:01:05,000
Next minute starts here.
`;

const VTT = `WEBVTT - Lecture 3
Kind: captions
Language: en

NOTE this is a comment
spanning two lines

STYLE
::cue { color: red }

intro
00:00:00.000 --> 00:00:04.000 align:start position:0%
Hello &lt;everyone&gt;

00:05.000 --> 00:09.000
Let us begin.
`;

const YOUTUBE = `WEBVTT
Kind: captions
Language: en

00:00:00.320 --> 00:00:03.510 align:start position:0%
 
hello<00:00:01.520><c> and</c><00:00:01.760><c> welcome</c>

00:00:03.510 --> 00:00:03.520 align:start position:0%
hello and welcome
 

00:00:03.520 --> 00:00:06.230 align:start position:0%
hello and welcome
to<00:00:04.100><c.colorE5E5E5> the</c><00:00:04.400><c> course</c>

00:00:06.230 --> 00:00:06.240 align:start position:0%
to the course
 

00:00:06.240 --> 00:00:09.000 align:start position:0%
to the course
today<00:00:07.000><c> we</c><00:00:07.500><c> start</c>
`;

describe('reading caption files', () => {
  it('reads an SRT: indexes, several lines, tags, entities and comma milliseconds', () => {
    expect(parseCaptions(SRT)).toEqual([
      { seconds: 1, text: 'Welcome to the lecture. Today: game theory.' },
      { seconds: 30, text: 'A strategy is a plan & more.' },
      { seconds: 62, text: 'Next minute starts here.' },
    ]);
    const read = readCaptions(SRT, 'Lecture 3');
    expect(read.blocks.map((b) => b.locator)).toEqual(['0:01', '1:02']);
    expect(read.blocks[0]?.text).toContain('A strategy is a plan & more.');
  });

  it('starts a part every minute', () => {
    const text = '00:00:00,000 --> 00:00:02,000\nOne\n\n00:00:59,000 --> 00:01:01,000\nTwo\n\n00:01:00,000 --> 00:01:02,000\nThree\n';
    expect(readCaptions(text, 't').blocks).toEqual([
      { text: 'One Two', locator: '0:00' },
      { text: 'Three', locator: '1:00' },
    ]);
  });

  it('reads a plain VTT: header lines, notes, styles, identifiers, settings and short times', () => {
    expect(parseCaptions(VTT)).toEqual([
      { seconds: 0, text: 'Hello <everyone>' },
      { seconds: 5, text: 'Let us begin.' },
    ]);
  });

  it('reads YouTube automatic captions with every spoken line once, in order, without tags', () => {
    expect(parseCaptions(YOUTUBE)).toEqual([
      { seconds: 0, text: 'hello and welcome' },
      { seconds: 3, text: 'to the course' },
      { seconds: 6, text: 'today we start' },
    ]);
  });

  it('names a part over an hour in with hours', () => {
    const read = readCaptions('01:02:05.000 --> 01:02:08.000\nLate in the talk.\n', 't');
    expect(read.blocks).toEqual([{ text: 'Late in the talk.', locator: '1:02:05' }]);
  });

  it('skips a cue whose timing line is broken and keeps the rest', () => {
    expect(parseCaptions('1\n00:xx --> yy\nBroken\n\n2\n00:00:05,000 --> 00:00:06,000\nFine\n')).toEqual([{ seconds: 5, text: 'Fine' }]);
  });

  it('gives nothing, and does not throw, for input that is not captions', () => {
    const garbage = '1\nnot a time --> either\nText\n\n2\n--> -->\nMore\n';
    for (const text of ['', '   \n\n', 'Just some prose.\n\nAnother paragraph.', garbage, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n <c></c> \n']) {
      expect(parseCaptions(text)).toBeNull();
      expect(readCaptions(text, 'Name')).toEqual({ title: 'Name', blocks: [] });
    }
  });

  it('is found by extension and read from bytes with the file name as title', async () => {
    expect(kindForFile('a.SRT')).toBe('captions');
    expect(kindForFile('b.vtt')).toBe('captions');
    const read = await readBytes('captions', Buffer.from(SRT), 'Lecture 3');
    expect(read.title).toBe('Lecture 3');
    expect(read.blocks).toHaveLength(2);
  });

  it('refuses a caption file with no cues in plain words', () => {
    expect(nothingToRead('captions', 'a.srt', 10, false)).toBe('a.srt has no captions to read: it holds no time-stamped lines.');
  });
});
