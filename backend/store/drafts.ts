import type { Database } from './db';
import { nowIso } from './db';

/** Unsent answers keyed by what they answer (e.g. `probe:<problemId>`). The value is opaque to the backend. */
export function getDraft(db: Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM drafts WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function getDrafts(db: Database, keys: string[]): Record<string, string> {
  const stmt = db.prepare('SELECT value FROM drafts WHERE key = ?');
  const out: Record<string, string> = {};
  for (const key of keys) {
    const row = stmt.get(key) as { value: string } | undefined;
    if (row) out[key] = row.value;
  }
  return out;
}

/** Save a draft; an empty value deletes it. */
export function setDraft(db: Database, key: string, value: string): void {
  if (!value) {
    deleteDrafts(db, [key]);
    return;
  }
  db.prepare('INSERT INTO drafts (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, value, nowIso());
}

export function deleteDrafts(db: Database, keys: string[]): void {
  const stmt = db.prepare('DELETE FROM drafts WHERE key = ?');
  for (const key of keys) stmt.run(key);
}
