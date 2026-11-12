import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { SourceKind } from '../../core/types';
import type { ReadResult } from '../types';
import { readHtml } from './html';
import { readMarkdown } from './markdown';
import { readPdf } from './pdf';
import { readDocx, readEpub, readNotebook, readPptx } from './office';

export function kindForFile(path: string): SourceKind | null {
  switch (extname(path).toLowerCase()) {
    case '.pdf':
      return 'pdf';
    case '.md':
    case '.markdown':
      return 'markdown';
    case '.txt':
      return 'text';
    case '.html':
    case '.htm':
      return 'html';
    case '.docx':
      return 'docx';
    case '.pptx':
      return 'pptx';
    case '.epub':
      return 'epub';
    case '.ipynb':
      return 'notebook';
    default:
      return null;
  }
}

export const SUPPORTED_EXTENSIONS = ['pdf', 'md', 'markdown', 'txt', 'html', 'htm', 'docx', 'pptx', 'epub', 'ipynb'];

/** What a reader is asked for: `pictures: false` when no pictures of pages can be made, so a PDF's picture pages are left out. */
export interface ReadOptions {
  pictures?: boolean;
}

export async function readSourceFile(path: string, options: ReadOptions = {}): Promise<{ kind: SourceKind; bytes: Buffer; result: ReadResult }> {
  const kind = kindForFile(path);
  if (!kind) throw new Error(`Unsupported file type: ${basename(path)}`);
  const bytes = await readFile(path);
  const fallbackTitle = basename(path, extname(path));
  const result = await readBytes(kind, bytes, fallbackTitle, options);
  return { kind, bytes, result };
}

export async function readBytes(kind: SourceKind, bytes: Buffer, fallbackTitle: string, options: ReadOptions = {}): Promise<ReadResult> {
  switch (kind) {
    case 'pdf':
      return readPdf(new Uint8Array(bytes), fallbackTitle, options);
    case 'html':
      return readHtml(decodeText(bytes), fallbackTitle);
    case 'docx':
      return readDocx(new Uint8Array(bytes), fallbackTitle);
    case 'pptx':
      return readPptx(new Uint8Array(bytes), fallbackTitle);
    case 'epub':
      return readEpub(new Uint8Array(bytes), fallbackTitle);
    case 'notebook':
      return readNotebook(decodeText(bytes), fallbackTitle);
    case 'markdown':
    case 'text':
    case 'session':
      return readMarkdown(decodeText(bytes), fallbackTitle);
  }
}

/**
 * Text files as people have them: UTF-8 with or without a byte-order mark, UTF-16 from Windows
 * editors, or an old single-byte encoding. The mark is dropped (it would hide a first-line heading);
 * bytes that are not valid UTF-8 are read as Windows-1252 rather than turned into "�".
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return new TextDecoder('windows-1252').decode(body);
  }
}

/** True when a read gave nothing to learn from: no block with any text, and no page that is a picture. */
export function hasNoText(result: ReadResult): boolean {
  return !result.blocks.some((b) => b.text.trim() || b.picture);
}
