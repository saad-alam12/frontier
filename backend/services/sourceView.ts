/**
 * A source as the viewer shows it (B5, design §8 "Sources"): a PDF's own file, drawn page by page, or
 * the text of each part with where it is (a heading, a slide, a page of a PDF whose copy is gone).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { revealTarget } from '../core/reveal';
import type { SourceKind } from '../core/types';
import { blocksFromParts } from '../ingest/chunker';
import type { Database } from '../store/db';
import { getSource, listChunks } from '../store/sources';

export interface SourceDocument {
  sourceId: string;
  title: string;
  kind: SourceKind;
  /** The stored PDF, to draw its pages; null for other kinds, or when the stored copy is gone. */
  pdf: Uint8Array | null;
  /** The text of each part with where it is; empty for a PDF whose pages are drawn. */
  parts: { locator: string; text: string }[];
  /** What can be shown outside the app: its file in Finder, or the page it was added from (its address). */
  reveal: { kind: 'file' } | { kind: 'page'; url: string } | null;
}

export function sourceDocument(db: Database, sourcesDir: string, sourceId: string): SourceDocument {
  const source = getSource(db, sourceId);
  if (!source) throw new Error('This source is no longer in your library.');
  let pdf: Uint8Array | null = null;
  if (source.kind === 'pdf' && source.path) {
    try {
      pdf = new Uint8Array(readFileSync(join(sourcesDir, source.path)));
    } catch {
      // the stored copy is gone: its pages are still there as text
    }
  }
  const parts = pdf ? [] : blocksFromParts(listChunks(db, sourceId)).map((b) => ({ locator: b.locator, text: b.text }));
  if (!pdf && parts.length === 0) throw new Error('There is nothing of this source to show: it has not been read yet.');
  const target = revealTarget(source, source.path ? join(sourcesDir, source.path) : null, existsSync);
  const reveal = target?.kind === 'page' ? { kind: 'page' as const, url: target.url } : target ? { kind: 'file' as const } : null;
  return { sourceId, title: source.title, kind: source.kind, pdf, parts, reveal };
}
