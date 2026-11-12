import { describe, expect, it } from 'vitest';
import { readMarkdown } from './readers/markdown';
import { readHtml } from './readers/html';
import { readPdf } from './readers/pdf';
import { kindForFile } from './readers';
import { blocksFromParts, chunkBlocks, collapseBuildPages, estimateTokens } from './chunker';

/** Builds a tiny valid PDF with one text line per page (Helvetica, no compression). */
export function makePdf(pages: string[]): Buffer {
  const objs: (string | null)[] = [];
  const add = (s: string | null) => {
    objs.push(s);
    return objs.length;
  };
  const catalog = add(null);
  const pagesObj = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: string[] = [];
  for (const text of pages) {
    const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj ET`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const page = add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    kids.push(`${page} 0 R`);
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

describe('markdown reader', () => {
  it('splits at headings with a heading-path locator and takes the title from H1', () => {
    const md = '# Lecture 3\n\nIntro text.\n\n## Nash\n\nNash text.\n\n### Existence\n\nExists.\n\n## SPE\n\nSPE text.';
    const r = readMarkdown(md, 'file');
    expect(r.title).toBe('Lecture 3');
    expect(r.blocks.map((b) => b.locator)).toEqual(['Lecture 3', 'Lecture 3 > Nash', 'Lecture 3 > Nash > Existence', 'Lecture 3 > SPE']);
    expect(r.blocks[1]?.text).toContain('Nash text.');
  });

  it('ignores headings inside code fences and handles plain text', () => {
    const r = readMarkdown('```\n# not a heading\n```\nbody', 'notes');
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]?.locator).toBe('start');
    expect(r.title).toBe('notes');
  });
});

describe('html reader', () => {
  it('extracts the main content with headings as locators', () => {
    const html = `<html><head><title>Lecture 3</title></head><body><nav>menu</nav><article>
      <h1>Nash equilibrium</h1><p>A strategy profile where no player can gain by deviating alone. This is the central solution concept of non-cooperative game theory and is used throughout the course.</p>
      <h2>Best responses</h2><p>A best response maximizes payoff given the others. Nash equilibria are mutual best responses, which is how we compute them in matrix games.</p>
      </article></body></html>`;
    const r = readHtml(html, 'file');
    expect(r.title).toBe('Lecture 3');
    expect(r.blocks.length).toBeGreaterThanOrEqual(2);
    expect(r.blocks.some((b) => b.locator === 'Best responses' && b.text.includes('mutual best responses'))).toBe(true);
    expect(r.blocks.some((b) => b.text.includes('menu'))).toBe(false);
  });
});

describe('pdf reader', () => {
  it('extracts one block per page with page locators', async () => {
    const pdf = makePdf(['Nash equilibrium: no player gains by deviating alone.', 'Backward induction solves finite games of perfect information.']);
    const r = await readPdf(new Uint8Array(pdf), 'lecture');
    expect(r.blocks.map((b) => b.locator)).toEqual(['p1', 'p2']);
    expect(r.blocks[0]?.text).toContain('Nash equilibrium');
    expect(r.blocks[1]?.text).toContain('Backward induction');
  });
});

describe('file kinds', () => {
  it('maps extensions', () => {
    expect(kindForFile('/x/a.PDF')).toBe('pdf');
    expect(kindForFile('a.md')).toBe('markdown');
    expect(kindForFile('a.htm')).toBe('html');
    expect(kindForFile('a.docx')).toBe('docx');
    expect(kindForFile('a.doc')).toBeNull();
  });
});

describe('collapseBuildPages', () => {
  it('keeps the fullest page of each animation build with the whole page range', () => {
    const blocks = [
      { text: 'Title slide', locator: 'p1' },
      { text: 'Chain rule', locator: 'p2' },
      { text: 'Chain rule\n  first term', locator: 'p3' },
      { text: 'Chain rule first term\nsecond term', locator: 'p4' },
      { text: 'Reverse mode', locator: 'p5' },
      { text: 'Something else entirely', locator: 'p6' },
    ];
    expect(collapseBuildPages(blocks)).toEqual([
      { text: 'Title slide', locator: 'p1' },
      { text: 'Chain rule first term\nsecond term', locator: 'p2–p4' },
      { text: 'Reverse mode', locator: 'p5' },
      { text: 'Something else entirely', locator: 'p6' },
    ]);
  });

  it('leaves pages of a clean script alone', () => {
    const blocks = [1, 2, 3].map((i) => ({ text: `Page ${i} has its own text.`, locator: `p${i}` }));
    expect(collapseBuildPages(blocks)).toEqual(blocks);
  });
});

describe('chunker', () => {
  it('packs blocks under the budget and keeps locator ranges', () => {
    const blocks = Array.from({ length: 10 }, (_, i) => ({ text: 'word '.repeat(200), locator: `p${i + 1}` }));
    const chunks = chunkBlocks(blocks, 600);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(estimateTokens(c.text)).toBeLessThanOrEqual(600 * 1.2);
    expect(chunks[0]?.locator).toMatch(/^p1–p\d+$/);
    expect(chunks[chunks.length - 1]?.locator).toMatch(/p10$/);
  });

  it('splits an oversized block at paragraph boundaries', () => {
    const big = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${'text '.repeat(60)}`).join('\n\n');
    const chunks = chunkBlocks([{ text: big, locator: 'p1' }], 400);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.locator === 'p1')).toBe(true);
    expect(chunks.map((c) => c.text).join('')).toContain('Paragraph 29');
  });

  it('marks where each block starts so ideas can cite pages, and gives the blocks back from stored parts', () => {
    const blocks = [
      { text: 'First page.', locator: 'p1' },
      { text: 'Second page.', locator: 'p2' },
    ];
    const [part] = chunkBlocks(blocks);
    expect(part).toEqual({ text: '[p1]\nFirst page.\n\n[p2]\nSecond page.', locator: 'p1–p2' });
    expect(blocksFromParts(part ? [part] : [])).toEqual(blocks);
    // parts stored before markers existed come back as one block each
    expect(blocksFromParts([{ text: 'Old text.', locator: 'p3–p4' }])).toEqual([{ text: 'Old text.', locator: 'p3–p4' }]);
  });

  it('folds a tiny trailing chunk into the previous one', () => {
    const chunks = chunkBlocks([{ text: 'a '.repeat(1000), locator: 'p1' }, { text: 'tail', locator: 'p2' }], 600);
    expect(chunks[chunks.length - 1]?.text.endsWith('tail')).toBe(true);
    expect(chunks[chunks.length - 1]?.locator).toBe('p1–p2');
  });
});
