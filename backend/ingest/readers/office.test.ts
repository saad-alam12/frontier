import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { nothingToRead } from '../../services/ingestion';
import { kindForFile, readBytes } from './index';
import { decodeXml } from './office';

const zip = (files: Record<string, string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const para = (text: string, style?: string, list = false) => `<w:p>${style || list ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${list ? '<w:numPr><w:ilvl w:val="0"/></w:numPr>' : ''}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

describe('reading Word, PowerPoint, EPUB and notebooks', () => {
  it('knows the new file types by their extension', () => {
    expect(['a.docx', 'b.pptx', 'c.epub', 'd.ipynb', 'e.doc'].map(kindForFile)).toEqual(['docx', 'pptx', 'epub', 'notebook', null]);
  });

  it('reads a Word document with its headings as places, lists and entities', async () => {
    const docx = zip({
      'word/document.xml': `<w:document ${W}><w:body>${para('Game theory', 'Title')}${para('Equilibrium', 'Heading1')}${para('No player gains by moving &amp; alone.')}${para('check each player', undefined, true)}${para('Dominance', 'Heading1')}${para('A strategy can be better whatever the others do.')}</w:body></w:document>`,
      'docProps/core.xml': '<cp:coreProperties xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Lecture 4</dc:title></cp:coreProperties>',
    });
    const read = await readBytes('docx', docx, 'fallback');
    expect(read.title).toBe('Lecture 4');
    expect(read.blocks.map((b) => b.locator)).toEqual(['Equilibrium', 'Dominance']);
    expect(read.blocks[0]?.text).toContain('No player gains by moving & alone.');
    expect(read.blocks[0]?.text).toContain('- check each player');
  });

  it('reads PowerPoint slides in the order they are shown, with their titles and speaker notes', async () => {
    const slide = (title: string, body: string) =>
      `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    const pptx = zip({
      'ppt/presentation.xml': '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>',
      'ppt/slides/slide1.xml': slide('Backward induction', 'Solve from the last move.'),
      'ppt/slides/slide2.xml': slide('Sequential games', 'Players move in turn.'),
      'ppt/slides/_rels/slide2.xml.rels': '<Relationships><Relationship Id="rId1" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
      'ppt/notesSlides/notesSlide1.xml': '<p:notes xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Mention chess here.</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>2</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>',
    });
    const read = await readBytes('pptx', pptx, 'Slides');
    expect(read.blocks.map((b) => b.locator)).toEqual(['slide 1', 'slide 2']);
    expect(read.blocks[0]?.text).toBe('## Sequential games\nPlayers move in turn.\nNotes: Mention chess here.');
    expect(read.blocks[1]?.text).toBe('## Backward induction\nSolve from the last move.');
  });

  it('reads an EPUB book in its reading order, chapter by chapter', async () => {
    const epub = zip({
      'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
      'OEBPS/content.opf': '<package><metadata><dc:title>Strategy</dc:title></metadata><manifest><item id="c2" href="ch2.xhtml"/><item id="c1" href="text/ch1.xhtml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
      'OEBPS/text/ch1.xhtml': '<html><body><h1>Games</h1><p>A game has players, strategies and payoffs.</p></body></html>',
      'OEBPS/ch2.xhtml': '<html><body><p>Equilibrium comes next.</p></body></html>',
    });
    const read = await readBytes('epub', epub, 'Book');
    expect(read.title).toBe('Strategy');
    expect(read.blocks.map((b) => b.locator)).toEqual(['chapter 1 > Games', 'chapter 2']);
    expect(read.blocks[0]?.text).toContain('A game has players');
  });

  it('reads a notebook: its text cells, and its code in fences', async () => {
    const nb = JSON.stringify({ metadata: { language_info: { name: 'python' } }, cells: [{ cell_type: 'markdown', source: ['# Simulation\n', 'We simulate a price war.'] }, { cell_type: 'code', source: 'prices = [10, 15]' }, { cell_type: 'code', source: '' }] });
    const read = await readBytes('notebook', Buffer.from(nb), 'notebook');
    expect(read.title).toBe('Simulation');
    expect(read.blocks[0]?.text).toContain('Cell 2:\n```python\nprices = [10, 15]\n```');
  });

  it('says plainly when a file is damaged, or has nothing to read', async () => {
    await expect(readBytes('docx', Buffer.from('not a zip'), 'x')).rejects.toThrow(/could not be opened/);
    await expect(readBytes('notebook', Buffer.from('{'), 'x')).rejects.toThrow(/not valid JSON/);
    expect(nothingToRead('pdf', 'scan.pdf', 2000, true)).toMatch(/pages look blank/);
    expect(nothingToRead('pptx', 'pictures.pptx', 2000, true)).toMatch(/export it as a PDF/);
    expect(nothingToRead('text', 'empty.txt', 0, true)).toBe('empty.txt is empty: the file has nothing in it.');
    expect(decodeXml('&lt;a&gt; &#233; &#x2014;')).toBe('<a> é —');
  });
});
