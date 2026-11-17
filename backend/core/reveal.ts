/**
 * Where a source can be shown outside the app (R8 E7): a file the learner added from disk or a
 * watched folder is shown where they keep it; when that file is gone (moved, deleted, an unplugged
 * drive), the copy Frontier stored is shown instead; a source added by a link opens its page. Pasted
 * text and session transcripts have nowhere to show.
 */
import type { Source } from './types';

export type RevealTarget = { kind: 'file'; path: string; stored: boolean } | { kind: 'page'; url: string } | null;

/** `storedPath` is the full path of the stored copy (null when there is none); `exists` says whether a file is there. */
export function revealTarget(source: Pick<Source, 'kind' | 'origin' | 'originalPath'>, storedPath: string | null, exists: (path: string) => boolean): RevealTarget {
  if (source.kind === 'session') return null;
  if (source.origin) return { kind: 'page', url: source.origin };
  if (source.originalPath && exists(source.originalPath)) return { kind: 'file', path: source.originalPath, stored: false };
  if (storedPath && exists(storedPath)) return { kind: 'file', path: storedPath, stored: true };
  return null;
}
