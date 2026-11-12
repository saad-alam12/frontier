import { describe, expect, it } from 'vitest';
import { chunkBlocks, collapseBuildPages, PICTURE_TOKENS } from './chunker';
import { isPicturePage } from './pageLayout';
import { fixturePdf } from './pdfFixture';
import { readPdf } from './readers/pdf';
import { pictureScale } from './pictures';

const prose = (n: number) => Array.from({ length: n }, (_, i) => `Line ${i + 1} of a page that explains its idea in words and goes on at some length.`);

describe('pages that are pictures', () => {
  it('marks scans, diagrams and pages with a large figure, and leaves text pages and small logos alone', async () => {
    const pdf = fixturePdf([
      { lines: prose(30) }, // a page of text
      { picture: 0.9 }, // a scan: one picture, no text
      { boxes: 8, lines: ['How attention flows'] }, // a diagram drawn in lines
      { picture: 0.5, lines: prose(12) }, // a paper's page with a large figure
      { picture: 0.02, lines: ['Lecture 4', 'Game theory'] }, // a title slide with a logo
      { picture: 0.4, lines: prose(55) }, // dense text with a figure: the words say it
    ]);
    const { blocks } = await readPdf(pdf, 'Fixture');
    expect(blocks.map((b) => [b.locator, b.picture ?? null])).toEqual([
      ['p1', null],
      ['p2', 2],
      ['p3', 3],
      ['p4', 4],
      ['p5', null],
      ['p6', null],
    ]);
    expect(blocks[1]?.text).toBe(''); // kept although it has no text
  });

  it('leaves picture pages out when no pictures can be made', async () => {
    const { blocks } = await readPdf(fixturePdf([{ lines: ['Words'] }, { picture: 0.9 }]), 'Fixture', { pictures: false });
    expect(blocks.map((b) => b.locator)).toEqual(['p1']);
    expect(blocks.every((b) => b.picture === undefined)).toBe(true);
  });

  it('decides from the share of the page and the amount of text', () => {
    const page = { textChars: 0, imageShare: 0, shapes: 0, shapeShare: 0 };
    expect(isPicturePage(page)).toBe(false); // a blank page
    expect(isPicturePage({ ...page, textChars: 40, imageShare: 0.06 })).toBe(true);
    expect(isPicturePage({ ...page, textChars: 40, shapes: 3, shapeShare: 0.5 })).toBe(false); // an underline or two
    expect(isPicturePage({ ...page, textChars: 1800, imageShare: 0.3 })).toBe(false);
    expect(isPicturePage({ ...page, textChars: 1800, shapes: 30, shapeShare: 0.3 })).toBe(true); // a plot drawn in vectors
  });

  it('sizes a picture for the model to read without scaling it down', () => {
    const a4 = pictureScale(595, 842);
    expect(595 * a4 * 842 * a4).toBeLessThanOrEqual(1_150_001);
    const slide = pictureScale(960, 540);
    expect(960 * slide).toBeLessThanOrEqual(1568);
  });
});

describe('parts with pictures', () => {
  it('counts a picture page as its picture, so a part holds a sensible number of them', () => {
    const blocks = Array.from({ length: 30 }, (_, i) => ({ text: 'Figure', locator: `p${i + 1}`, picture: i + 1 }));
    const parts = chunkBlocks(blocks, (PICTURE_TOKENS + 2) * 10);
    expect(parts.length).toBe(3);
    expect(parts[0]?.text.match(/^\[p\d+\]$/gm)).toHaveLength(10);
  });

  it('keeps a picture page with only a heading, which may show another figure than the next page', () => {
    const kept = collapseBuildPages([
      { text: 'Results', locator: 'p1', picture: 1 },
      { text: 'Results', locator: 'p2', picture: 2 },
      { text: 'Attention lets each word look at every other word', locator: 'p3', picture: 3 },
      { text: 'Attention lets each word look at every other word, weighted by relevance', locator: 'p4', picture: 4 },
    ]);
    expect(kept.map((b) => [b.locator, b.picture])).toEqual([
      ['p1', 1],
      ['p2', 2],
      ['p3–p4', 4],
    ]);
  });
});
