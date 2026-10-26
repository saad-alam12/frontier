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

export function recordBug(db: Database, nodeId: string, description: string): Bug {
  const now = nowIso();
  const bug: Bug = { id: newId('bug'), nodeId, description, firstSeen: now, lastSeen: now, resolvedAt: null };
  db.prepare('INSERT INTO bugs (id, node_id, description, first_seen, last_seen, resolved_at) VALUES (?, ?, ?, ?, ?, NULL)').run(bug.id, nodeId, description, now, now);
  return bug;
}

export function touchBug(db: Database, bugId: string): void {
  db.prepare('UPDATE bugs SET last_seen = ?, resolved_at = NULL WHERE id = ?').run(nowIso(), bugId);
}

export function resolveBug(db: Database, bugId: string): void {
  db.prepare('UPDATE bugs SET resolved_at = ? WHERE id = ?').run(nowIso(), bugId);
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
