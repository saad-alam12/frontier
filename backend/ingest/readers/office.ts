/**
 * Readers for the formats that are ZIP files of XML (design §7, "Reading"): Word (.docx), PowerPoint
 * (.pptx) and EPUB books; and Jupyter notebooks (.ipynb, JSON). Text only: headings become locators
 * (Word), slides are "slide N" with their speaker notes (PowerPoint), chapters follow the book's reading
 * order (EPUB), cells keep their order with code in fences (notebooks).
 */
import { strFromU8, unzipSync } from 'fflate';
import type { ReadResult, TextBlock } from '../types';
import { readHtml } from './html';
import { readMarkdown } from './markdown';

type Files = Record<string, Uint8Array>;

/** The ZIP's files, or a plain message when it is not one (a renamed or damaged file). */
function unzip(bytes: Uint8Array, what: string): Files {
  try {
    return unzipSync(bytes);
  } catch {
    throw new Error(`This ${what} could not be opened: the file is damaged, or it is not really a ${what}.`);
  }
}

const text = (files: Files, path: string): string | null => {
  const f = files[path];
  return f ? strFromU8(f) : null;
};

/** XML character references and the five named entities. */
export function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** The document's title from its core properties, if it has one. */
function coreTitle(files: Files): string | null {
  const core = text(files, 'docProps/core.xml');
  const title = core ? /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/.exec(core)?.[1] : undefined;
  return title ? decodeXml(title).trim() || null : null;
}

/** The text runs of one paragraph (`w:t` in Word, `a:t` in PowerPoint), with tabs and line breaks. */
function runs(paragraph: string, prefix: 'w' | 'a'): string {
  const parts: string[] = [];
  const token = new RegExp(`<${prefix}:t(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${prefix}:t>|<${prefix}:tab\\s*/>|<${prefix}:br\\s*/>`, 'g');
  for (const m of paragraph.matchAll(token)) {
    if (m[1] !== undefined) parts.push(decodeXml(m[1]));
    else parts.push(m[0].includes(':tab') ? '\t' : '\n');
  }
  return parts.join('');
}

// ---------- Word ----------

export function readDocx(bytes: Uint8Array, fallbackTitle: string): ReadResult {
  const files = unzip(bytes, 'Word document');
  const body = text(files, 'word/document.xml');
  if (body === null) throw new Error('This Word document could not be opened: it has no document part.');
  const lines: string[] = [];
  let styledTitle: string | null = null;
  for (const m of body.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)) {
    const p = m[0];
    const line = runs(p, 'w').trim();
    if (!line) continue;
    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? '';
    // the Title style names the document; headings below it are the places
    if (/^Title$/i.test(style)) {
      styledTitle ??= line;
      continue;
    }
    const heading = Number(/^Heading(\d)$/i.exec(style)?.[1] ?? 0);
    const listed = /<w:numPr>/.test(p);
    lines.push(heading ? `${'#'.repeat(Math.min(6, heading))} ${line}` : listed ? `- ${line}` : line);
  }
  const title = coreTitle(files) ?? styledTitle;
  const result = readMarkdown(lines.join('\n\n'), title ?? fallbackTitle);
  return { ...result, title: title ?? result.title };
}

// ---------- PowerPoint ----------

/** Targets of a relationships file by id. */
function relationships(xml: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of (xml ?? '').matchAll(/<Relationship\s[^>]*>/g)) {
    const id = /\sId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\sTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) out.set(id, target);
  }
  return out;
}

/** A path relative to a folder inside the package, with `..` resolved. */
function resolve(folder: string, target: string): string {
  const parts = target.startsWith('/') ? [] : folder.split('/').filter(Boolean);
  for (const piece of target.replace(/^\//, '').split('/')) {
    if (piece === '..') parts.pop();
    else if (piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}

/** Paragraph texts of a slide or notes part, the title placeholder's first. */
function slideParagraphs(xml: string): { title: string | null; lines: string[] } {
  let title: string | null = null;
  const lines: string[] = [];
  for (const shape of xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
    const isTitle = /<p:ph[^>]*type="(?:title|ctrTitle)"/.test(shape[0]);
    const paragraphs = [...shape[0].matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((p) => runs(p[0], 'a').trim()).filter(Boolean);
    if (isTitle && !title && paragraphs.length) title = paragraphs.join(' ');
    else lines.push(...paragraphs);
  }
  // text in tables and groups, outside plain shapes
  if (lines.length === 0 && !title) for (const p of xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)) lines.push(runs(p[0], 'a').trim());
  return { title, lines: lines.filter(Boolean) };
}

export function readPptx(bytes: Uint8Array, fallbackTitle: string): ReadResult {
  const files = unzip(bytes, 'PowerPoint file');
  const presentation = text(files, 'ppt/presentation.xml');
  if (presentation === null) throw new Error('This PowerPoint file could not be opened: it has no presentation part.');
  const rels = relationships(text(files, 'ppt/_rels/presentation.xml.rels'));
  // the order the slides are shown in, which need not be their file names' order
  const order = [...presentation.matchAll(/<p:sldId\s[^>]*r:id="([^"]+)"/g)].map((m) => rels.get(m[1] as string)).filter((t): t is string => Boolean(t)).map((t) => resolve('ppt', t));
  const blocks: TextBlock[] = [];
  order.forEach((path, i) => {
    const xml = text(files, path);
    if (xml === null) return;
    const slide = slideParagraphs(xml);
    const folder = path.slice(0, path.lastIndexOf('/'));
    const slideRels = relationships(text(files, `${folder}/_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`));
    const notesTarget = [...slideRels.values()].find((t) => t.includes('notesSlide'));
    const notesXml = notesTarget ? text(files, resolve(folder, notesTarget)) : null;
    // the notes part repeats the slide number and image placeholders; only its body text is kept
    const notes = notesXml ? slideParagraphs(notesXml).lines.filter((l) => !/^\d+$/.test(l)) : [];
    const parts = [slide.title ? `## ${slide.title}` : '', ...slide.lines, notes.length ? `Notes: ${notes.join(' ')}` : ''].filter(Boolean);
    if (parts.length) blocks.push({ text: parts.join('\n'), locator: `slide ${i + 1}` });
  });
  return { title: coreTitle(files) ?? fallbackTitle, blocks };
}

// ---------- EPUB ----------

export function readEpub(bytes: Uint8Array, fallbackTitle: string): ReadResult {
  const files = unzip(bytes, 'EPUB book');
  const container = text(files, 'META-INF/container.xml');
  const opfPath = container ? /full-path="([^"]+)"/.exec(container)?.[1] : undefined;
  const opf = opfPath ? text(files, opfPath) : null;
  if (!opfPath || opf === null) throw new Error('This EPUB book could not be opened: its table of contents is missing.');
  const folder = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const manifest = new Map<string, string>();
  for (const m of opf.matchAll(/<item\s[^>]*>/g)) {
    const id = /\sid="([^"]+)"/.exec(m[0])?.[1];
    const href = /\shref="([^"]+)"/.exec(m[0])?.[1];
    if (id && href) manifest.set(id, decodeURIComponent(href));
  }
  const title = decodeXml(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/.exec(opf)?.[1] ?? '').trim() || fallbackTitle;
  const blocks: TextBlock[] = [];
  let chapter = 0;
  for (const ref of opf.matchAll(/<itemref\s[^>]*idref="([^"]+)"/g)) {
    const href = manifest.get(ref[1] as string);
    const xhtml = href ? text(files, resolve(folder, href)) : null;
    if (!xhtml) continue;
    // a book's chapters are its main content: no article extraction, which would cut parts of them
    const read = readHtml(xhtml, '', { article: false });
    if (!read.blocks.some((b) => b.text.trim())) continue;
    chapter += 1;
    for (const b of read.blocks) blocks.push({ text: b.text, locator: b.locator === 'start' ? `chapter ${chapter}` : `chapter ${chapter} > ${b.locator}` });
  }
  return { title, blocks };
}

// ---------- Jupyter notebooks ----------

interface NotebookCell {
  cell_type?: string;
  source?: string | string[];
}

export function readNotebook(raw: string, fallbackTitle: string): ReadResult {
  let notebook: { cells?: NotebookCell[]; metadata?: { language_info?: { name?: string } } };
  try {
    notebook = JSON.parse(raw) as typeof notebook;
  } catch {
    throw new Error('This notebook could not be opened: it is not valid JSON.');
  }
  const language = notebook.metadata?.language_info?.name ?? 'python';
  const parts: string[] = [];
  (notebook.cells ?? []).forEach((cell, i) => {
    const source = (Array.isArray(cell.source) ? cell.source.join('') : (cell.source ?? '')).trim();
    if (!source) return;
    if (cell.cell_type === 'markdown') parts.push(source);
    else if (cell.cell_type === 'code') parts.push(`Cell ${i + 1}:\n\`\`\`${language}\n${source}\n\`\`\``);
  });
  // headings in markdown cells give the locators, as in any Markdown file
  return readMarkdown(parts.join('\n\n'), fallbackTitle);
}
