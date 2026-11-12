import type * as PdfJsModule from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ReadResult, TextBlock } from '../types';
import { isPicturePage, measureOperators } from '../pageLayout';

interface TextItemLike {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
}

type PdfJs = typeof PdfJsModule;

/**
 * Inside Electron (Node 24) the modern build is used because the legacy build crashes Electron's
 * Node runtime on import. Outside Electron (tests, scripts on Node 22) the legacy build is used
 * because the modern one expects newer builtins. Same API either way.
 */
async function loadPdfJs(): Promise<PdfJs> {
  const inElectron = Boolean(process.versions['electron']);
  const modulePath = inElectron ? 'pdfjs-dist/build/pdf.mjs' : 'pdfjs-dist/legacy/build/pdf.mjs';
  const workerPath = inElectron ? 'pdfjs-dist/build/pdf.worker.mjs' : 'pdfjs-dist/legacy/build/pdf.worker.mjs';
  const pdfjs = (await import(/* @vite-ignore */ modulePath)) as PdfJs;
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve(workerPath);
  return pdfjs;
}

/**
 * One block per page, locator `p<N>`. Lines are rebuilt from item positions. A page whose meaning is
 * in a picture (a scan, a diagram, a large figure) is marked with its page number, and kept even when
 * it has no text; `pictures: false` leaves such pages out (when no pictures can be made).
 */
export async function readPdf(data: Uint8Array, fallbackTitle: string, options: { pictures?: boolean } = {}): Promise<ReadResult> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0 });
  const doc = await task.promise.catch((error: unknown) => {
    // pdfjs names the error; its own message ("No password given") is not one a learner should have to read
    if (error instanceof Error && error.name === 'PasswordException') throw new Error('This PDF is locked with a password. Save a copy without the password and add that.');
    if (error instanceof Error && error.name === 'InvalidPDFException') throw new Error('This file is not a readable PDF. It may be damaged.');
    throw error;
  });
  const blocks: TextBlock[] = [];
  let title = fallbackTitle;
  try {
    const meta = (await doc.getMetadata()) as { info?: { Title?: unknown } };
    const t = meta.info?.Title;
    if (typeof t === 'string' && t.trim()) title = t.trim();
  } catch {
    // metadata is optional
  }
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = itemsToText(content.items as TextItemLike[]);
    const picture = options.pictures !== false && (await isPicture(pdfjs, page, text));
    if (picture) blocks.push({ text, locator: `p${i}`, picture: i });
    else if (text.trim()) blocks.push({ text, locator: `p${i}` });
    page.cleanup();
  }
  await task.destroy();
  return { title, blocks };
}

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<PdfJs['getDocument']>['promise']>['getPage']>>;

/** Whether the page says what it says in a picture; a page whose drawing cannot be read counts as text. */
async function isPicture(pdfjs: PdfJs, page: PdfPage, text: string): Promise<boolean> {
  try {
    const list = await page.getOperatorList();
    return isPicturePage(measureOperators(list.fnArray, list.argsArray, pdfjs.OPS, page.view, text.replace(/\s+/g, '').length));
  } catch {
    return false;
  }
}

function itemsToText(items: TextItemLike[]): string {
  let out = '';
  let lastY: number | null = null;
  for (const item of items) {
    const str = item.str ?? '';
    const y = item.transform?.[5];
    if (lastY !== null && typeof y === 'number' && Math.abs(y - lastY) > 2 && !out.endsWith('\n')) out += '\n';
    out += str;
    if (item.hasEOL) out += '\n';
    if (typeof y === 'number') lastY = y;
  }
  return out
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}
