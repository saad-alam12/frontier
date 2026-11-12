/** The learner's free notes on ideas (you layer): one per idea, written in their words. */
import type { Database } from './db';
import { nowIso } from './db';

export function ideaNotesFor(db: Database, nodeIds: Iterable<string>): Map<string, string> {
  const ids = [...nodeIds];
  if (ids.length === 0) return new Map();
  const rows = db.prepare('SELECT node_id, text FROM idea_notes WHERE node_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids)) as { node_id: string; text: string }[];
  return new Map(rows.map((r) => [r.node_id, r.text]));
}

/** Save a note; an empty one removes it. */
export function saveIdeaNote(db: Database, nodeId: string, text: string): void {
  if (!text.trim()) {
    db.prepare('DELETE FROM idea_notes WHERE node_id = ?').run(nodeId);
    return;
  }
  db.prepare('INSERT INTO idea_notes (node_id, text, updated_at) VALUES (?, ?, ?) ON CONFLICT(node_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at').run(nodeId, text, nowIso());
}
