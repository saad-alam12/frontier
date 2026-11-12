/** Folders the learner watches (design §7, "Watched folders"), and the files seen in them. */
import type { Database } from './db';
import { nowIso } from './db';

export interface WatchedFolder {
  path: string;
  goalId: string | null;
  addedAt: string;
}

export interface WatchedFile {
  path: string;
  folder: string;
  size: number;
  mtimeMs: number;
  sourceId: string | null;
  error: string | null;
}

export function listWatchedFolders(db: Database): WatchedFolder[] {
  return (db.prepare('SELECT path, goal_id, added_at FROM watched_folders ORDER BY added_at').all() as { path: string; goal_id: string | null; added_at: string }[]).map((r) => ({ path: r.path, goalId: r.goal_id, addedAt: r.added_at }));
}

export function addWatchedFolder(db: Database, path: string, goalId: string | null): void {
  db.prepare('INSERT INTO watched_folders (path, goal_id, added_at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET goal_id = excluded.goal_id').run(path, goalId, nowIso());
}

export function removeWatchedFolder(db: Database, path: string): void {
  db.prepare('DELETE FROM watched_folders WHERE path = ?').run(path);
}

export function watchedFiles(db: Database, folder: string): Map<string, WatchedFile> {
  const rows = db.prepare('SELECT path, folder, size, mtime_ms, source_id, error FROM watched_files WHERE folder = ?').all(folder) as { path: string; folder: string; size: number; mtime_ms: number; source_id: string | null; error: string | null }[];
  return new Map(rows.map((r) => [r.path, { path: r.path, folder: r.folder, size: r.size, mtimeMs: r.mtime_ms, sourceId: r.source_id, error: r.error }]));
}

export function recordWatchedFile(db: Database, file: WatchedFile): void {
  db.prepare(
    'INSERT INTO watched_files (path, folder, size, mtime_ms, source_id, error, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET folder = excluded.folder, size = excluded.size, mtime_ms = excluded.mtime_ms, source_id = excluded.source_id, error = excluded.error, seen_at = excluded.seen_at',
  ).run(file.path, file.folder, file.size, file.mtimeMs, file.sourceId, file.error, nowIso());
}
