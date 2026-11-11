/**
 * Fetching what a link points at (design §7): a web page, a PDF or a text file by its address, and a
 * video's title. The app says who it is and asks once, like a browser opening the page; a site that
 * refuses is not worked around, the learner pastes the text instead.
 */
import { basename, extname } from 'node:path';
import type { SourceKind } from '../core/types';
import { kindForFile } from './readers';

/** The part of `fetch` this needs; tests pass a fake, the app passes the system's. */
export type Fetcher = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal; redirect?: 'follow' }) => Promise<Response>;

export interface FetchedDocument {
  kind: SourceKind;
  bytes: Buffer;
  /** A file name for the stored copy, from the address. */
  name: string;
}

const TIMEOUT_MS = 30_000;
/** Lecture PDFs with pictures run to tens of megabytes; beyond this it is not a document to read. */
const MAX_BYTES = 60 * 1024 * 1024;

/** A problem with a link, worded for the learner. */
export class LinkError extends Error {}

function kindOf(contentType: string, url: URL): SourceKind | null {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'html';
  if (type === 'application/pdf') return 'pdf';
  if (type === 'text/markdown' || type === 'text/x-markdown') return 'markdown';
  const byName = kindForFile(url.pathname);
  if (type === 'text/plain') return byName === 'markdown' ? 'markdown' : 'text';
  // servers that do not say what they send: go by the name
  if (type === '' || type === 'application/octet-stream' || type === 'binary/octet-stream') return byName;
  return null;
}

const EXTENSION: Partial<Record<SourceKind, string>> = { html: '.html', pdf: '.pdf', markdown: '.md', text: '.txt' };

/** "en.wikipedia.org-Nash_equilibrium.html": readable in the sources folder, safe as a file name. */
function fileName(url: URL, kind: SourceKind): string {
  const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    // a badly escaped address keeps its raw last part
  }
  const stem = basename(decoded, extname(decoded));
  const clean = `${url.hostname}${stem ? `-${stem}` : ''}`.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
  return `${clean}${EXTENSION[kind] ?? '.txt'}`;
}

async function readLimited(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) throw new LinkError('That file is too large to read from a link. Download it and add it as a file.');
  const reader = response.body?.getReader();
  if (!reader) return Buffer.from(await response.arrayBuffer());
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new LinkError('That file is too large to read from a link. Download it and add it as a file.');
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

async function get(fetcher: Fetcher, url: string, userAgent: string, accept: string): Promise<Response> {
  try {
    return await fetcher(url, { headers: { 'User-Agent': userAgent, Accept: accept }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') throw new LinkError('The site took too long to answer. Try again, or copy the text and paste it.');
    throw new LinkError('That address could not be reached. Check it and your connection.');
  }
}

/** Fetch the document at an address: a web page, a PDF, Markdown or plain text. */
export async function fetchDocument(fetcher: Fetcher, address: string, userAgent: string): Promise<FetchedDocument> {
  const response = await get(fetcher, address, userAgent, 'text/html,application/xhtml+xml,application/pdf,text/markdown,text/plain;q=0.9,*/*;q=0.5');
  if (response.status === 401 || response.status === 403 || response.status === 429) throw new LinkError('That site did not let Frontier read the page. Open it in your browser, copy the text and paste it.');
  if (response.status === 404 || response.status === 410) throw new LinkError('There is no page at that address.');
  if (!response.ok) throw new LinkError(`The site answered with an error (${response.status}). Try again later, or copy the text and paste it.`);
  const url = new URL(response.url || address);
  const kind = kindOf(response.headers.get('content-type') ?? '', url);
  if (!kind) throw new LinkError('That address is not a web page, a PDF or a text file, so there is nothing to read.');
  return { kind, bytes: await readLimited(response), name: fileName(url, kind) };
}

/**
 * A video's title, from the public description of the video that its site offers for embedding.
 * Empty when it cannot be had; the learner then names it.
 */
export async function fetchVideoTitle(fetcher: Fetcher, videoUrl: string, userAgent: string): Promise<string> {
  try {
    const response = await get(fetcher, `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(videoUrl)}`, userAgent, 'application/json');
    if (!response.ok) return '';
    const body = (await response.json()) as { title?: unknown };
    return typeof body.title === 'string' ? body.title.trim().slice(0, 120) : '';
  } catch {
    return '';
  }
}
