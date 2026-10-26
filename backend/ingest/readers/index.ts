import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { SourceKind } from '../../core/types';
import type { ReadResult } from '../types';
import { readHtml } from './html';
import { readMarkdown } from './markdown';
import { readPdf } from './pdf';

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
    default:
      return null;
  }
}

export const SUPPORTED_EXTENSIONS = ['pdf', 'md', 'markdown', 'txt', 'html', 'htm'];

export async function readSourceFile(path: string): Promise<{ kind: SourceKind; bytes: Buffer; result: ReadResult }> {
  const kind = kindForFile(path);
  if (!kind) throw new Error(`Unsupported file type: ${basename(path)}`);
  const bytes = await readFile(path);
  const fallbackTitle = basename(path, extname(path));
  const result = await readBytes(kind, bytes, fallbackTitle);
  return { kind, bytes, result };
}

export async function readBytes(kind: SourceKind, bytes: Buffer, fallbackTitle: string): Promise<ReadResult> {
  switch (kind) {
    case 'pdf':
      return readPdf(new Uint8Array(bytes), fallbackTitle);
    case 'html':
      return readHtml(bytes.toString('utf8'), fallbackTitle);
    case 'markdown':
    case 'text':
    case 'session':
      return readMarkdown(bytes.toString('utf8'), fallbackTitle);
  }
}
