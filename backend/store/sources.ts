import type { Database } from './db';
import { nowIso, parseJson } from './db';
import { newId } from './ids';
import { EXTRACTION } from '../core/types';
import type { Source, SourceKind } from '../core/types';

interface SourceRow {
  id: string;
  kind: SourceKind;
  title: string;
  path: string | null;
  hash: string;
  added_at: string;
  status: Source['status'];
  chunk_count: number;
  chunks_done: number;
  error: string | null;
  extraction: number;
}

export interface SourceChunk {
  id: string;
  sourceId: string;
  idx: number;
  text: string;
  locator: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  attempts: number;
  error: string | null;
  nodeIds: string[];
  conflicts: { nodeId: string; description: string }[];
}

interface ChunkRow {
  id: string;
  source_id: string;
  idx: number;
  text: string;
  locator: string;
  status: SourceChunk['status'];
  attempts: number;
  error: string | null;
  node_ids: string;
  conflicts: string;
}

const toSource = (r: SourceRow): Source => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  path: r.path,
  hash: r.hash,
  addedAt: r.added_at,
  status: r.status,
  chunkCount: r.chunk_count,
  chunksDone: r.chunks_done,
  error: r.error,
  extraction: r.extraction,
});

const toChunk = (r: ChunkRow): SourceChunk => ({
  id: r.id,
  sourceId: r.source_id,
  idx: r.idx,
  text: r.text,
  locator: r.locator,
  status: r.status,
  attempts: r.attempts,
  error: r.error,
  nodeIds: parseJson<string[]>(r.node_ids, []),
  conflicts: parseJson<{ nodeId: string; description: string }[]>(r.conflicts, []),
});

export function findSourceByHash(db: Database, hash: string): Source | undefined {
  const row = db.prepare('SELECT * FROM sources WHERE hash = ?').get(hash) as SourceRow | undefined;
  return row ? toSource(row) : undefined;
}

export function getSource(db: Database, id: string): Source | undefined {
  const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined;
  return row ? toSource(row) : undefined;
}

export function listSources(db: Database): Source[] {
  return (db.prepare('SELECT * FROM sources ORDER BY added_at DESC').all() as unknown as SourceRow[]).map(toSource);
}

export function createSource(db: Database, input: { kind: SourceKind; title: string; path: string | null; hash: string }, chunks: { text: string; locator: string }[]): Source {
  const id = newId('src');
  const addedAt = nowIso();
  db.prepare('INSERT INTO sources (id, kind, title, path, hash, added_at, status, chunk_count, chunks_done, extraction) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)').run(
    id,
    input.kind,
    input.title,
    input.path,
    input.hash,
    addedAt,
    'pending',
    chunks.length,
    EXTRACTION,
  );
  insertChunks(db, id, chunks);
  return getSource(db, id) as Source;
}

function insertChunks(db: Database, sourceId: string, chunks: { text: string; locator: string }[]): void {
  const insert = db.prepare("INSERT INTO source_chunks (id, source_id, idx, text, locator, status) VALUES (?, ?, ?, ?, ?, 'pending')");
  chunks.forEach((c, i) => insert.run(newId('chunk'), sourceId, i, c.text, c.locator));
}

/**
 * Start a source over with new parts (it is being read again): its parts, coverage and worked examples
 * go, and it waits to be read with the current extraction. The ideas themselves are the caller's to keep
 * or retire.
 */
export function resetSourceParts(db: Database, sourceId: string, chunks: { text: string; locator: string }[]): void {
  db.prepare('DELETE FROM source_coverage WHERE source_id = ?').run(sourceId);
  db.prepare('DELETE FROM examples WHERE source_id = ?').run(sourceId);
  db.prepare('DELETE FROM source_chunks WHERE source_id = ?').run(sourceId);
  insertChunks(db, sourceId, chunks);
  db.prepare("UPDATE sources SET status = 'pending', chunk_count = ?, chunks_done = 0, error = NULL, extraction = ? WHERE id = ?").run(chunks.length, EXTRACTION, sourceId);
}

/** Ideas some other source also covers. */
export function coveredElsewhere(db: Database, sourceId: string): Set<string> {
  return new Set((db.prepare('SELECT DISTINCT node_id FROM source_coverage WHERE source_id != ?').all(sourceId) as { node_id: string }[]).map((r) => r.node_id));
}

/** Ideas some source outside this set also covers (erasing a set of sources keeps these). */
export function coveredOutside(db: Database, sourceIds: string[]): Set<string> {
  const rows = db.prepare('SELECT source_id, node_id FROM source_coverage').all() as { source_id: string; node_id: string }[];
  return new Set(rows.filter((r) => !sourceIds.includes(r.source_id)).map((r) => r.node_id));
}

export function deleteSource(db: Database, id: string): void {
  db.prepare('DELETE FROM sources WHERE id = ?').run(id);
}

export function listChunks(db: Database, sourceId: string): SourceChunk[] {
  return (db.prepare('SELECT * FROM source_chunks WHERE source_id = ? ORDER BY idx').all(sourceId) as unknown as ChunkRow[]).map(toChunk);
}

export function updateChunk(db: Database, chunkId: string, patch: Partial<Pick<SourceChunk, 'status' | 'attempts' | 'error' | 'nodeIds' | 'conflicts'>>): void {
  const row = db.prepare('SELECT * FROM source_chunks WHERE id = ?').get(chunkId) as ChunkRow | undefined;
  if (!row) return;
  const next = { ...toChunk(row), ...patch };
  db.prepare('UPDATE source_chunks SET status = ?, attempts = ?, error = ?, node_ids = ?, conflicts = ? WHERE id = ?').run(
    next.status,
    next.attempts,
    next.error,
    JSON.stringify(next.nodeIds),
    JSON.stringify(next.conflicts),
    chunkId,
  );
}

export function updateSourceStatus(db: Database, id: string, patch: Partial<Pick<Source, 'status' | 'chunksDone' | 'error'>>): void {
  const current = getSource(db, id);
  if (!current) return;
  const next = { ...current, ...patch };
  db.prepare('UPDATE sources SET status = ?, chunks_done = ?, error = ? WHERE id = ?').run(next.status, next.chunksDone, next.error, id);
}

export function addCoverage(db: Database, sourceId: string, nodeIds: Iterable<string>): void {
  const stmt = db.prepare('INSERT OR IGNORE INTO source_coverage (source_id, node_id) VALUES (?, ?)');
  for (const n of nodeIds) stmt.run(sourceId, n);
}

export function coveredNodeIds(db: Database, sourceId: string): string[] {
  return (db.prepare('SELECT node_id FROM source_coverage WHERE source_id = ?').all(sourceId) as { node_id: string }[]).map((r) => r.node_id);
}

/**
 * The parts of sources that an idea was read from, the learner's own material before the app's
 * session transcripts, newest first within each.
 */
export function chunksCoveringNode(db: Database, nodeId: string, limit = 3): { sourceId: string; sourceTitle: string; locator: string; text: string }[] {
  const rows = db
    .prepare(
      `SELECT c.locator, c.text, s.title, s.id FROM source_chunks c JOIN sources s ON s.id = c.source_id
       WHERE c.status = 'done' AND c.node_ids LIKE ? ORDER BY (s.kind = 'session'), s.added_at DESC, c.idx LIMIT ?`,
    )
    .all(`%"${nodeId}"%`, limit) as unknown as { locator: string; text: string; title: string; id: string }[];
  return rows.map((r) => ({ sourceId: r.id, sourceTitle: r.title, locator: r.locator, text: r.text }));
}
