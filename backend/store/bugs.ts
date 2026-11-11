import type { Database } from './db';
import { nowIso } from './db';
import { newId } from './ids';
import type { Bug } from '../core/types';

interface BugRow {
  id: string;
  node_id: string;
  description: string;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
}

const toBug = (r: BugRow): Bug => ({ id: r.id, nodeId: r.node_id, description: r.description, firstSeen: r.first_seen, lastSeen: r.last_seen, resolvedAt: r.resolved_at });

/** `at` is when the answer that showed it was given. */
export function recordBug(db: Database, nodeId: string, description: string, at: string = nowIso()): Bug {
  const bug: Bug = { id: newId('bug'), nodeId, description, firstSeen: at, lastSeen: at, resolvedAt: null };
  db.prepare('INSERT INTO bugs (id, node_id, description, first_seen, last_seen, resolved_at) VALUES (?, ?, ?, ?, ?, NULL)').run(bug.id, nodeId, description, at, at);
  return bug;
}

/** Seen again: it is open, and it was last seen at the later of the two times. */
export function touchBug(db: Database, bugId: string, at: string = nowIso()): void {
  db.prepare('UPDATE bugs SET last_seen = max(last_seen, ?), resolved_at = NULL WHERE id = ?').run(at, bugId);
}

export function resolveBug(db: Database, bugId: string, at: string = nowIso()): void {
  db.prepare('UPDATE bugs SET resolved_at = ? WHERE id = ?').run(at, bugId);
}

export function listBugsForNode(db: Database, nodeId: string, includeResolved = false): Bug[] {
  const rows = includeResolved
    ? (db.prepare('SELECT * FROM bugs WHERE node_id = ? ORDER BY first_seen').all(nodeId) as unknown as BugRow[])
    : (db.prepare('SELECT * FROM bugs WHERE node_id = ? AND resolved_at IS NULL ORDER BY first_seen').all(nodeId) as unknown as BugRow[]);
  return rows.map(toBug);
}

export function listOpenBugs(db: Database): Bug[] {
  return (db.prepare('SELECT * FROM bugs WHERE resolved_at IS NULL ORDER BY last_seen DESC').all() as unknown as BugRow[]).map(toBug);
}
