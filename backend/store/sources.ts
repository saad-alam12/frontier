import type { Database } from './db';
import { nowIso, parseJson } from './db';
import { newId } from './ids';
import { EXTRACTION } from '../core/types';
import type { Source, SourceKind } from '../core/types';
import { blocksFromParts } from '../ingest/chunker';

interface SourceRow {
  id: string;
  kind: SourceKind;
  title: string;
  path: string | null;
  hash: string;
  origin: string | null;
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
  origin: r.origin,
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

/** The source added from this address, if any: a page changes a little with every visit, so its content hash would not find it. */
export function findSourceByOrigin(db: Database, origin: string): Source | undefined {
  const row = db.prepare('SELECT * FROM sources WHERE origin = ? ORDER BY added_at LIMIT 1').get(origin) as SourceRow | undefined;
  return row ? toSource(row) : undefined;
}

export function getSource(db: Database, id: string): Source | undefined {
  const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined;
  return row ? toSource(row) : undefined;
}

export function listSources(db: Database): Source[] {
  return (db.prepare('SELECT * FROM sources ORDER BY added_at DESC').all() as unknown as SourceRow[]).map(toSource);
}

export function createSource(db: Database, input: { kind: SourceKind; title: string; path: string | null; hash: string; origin?: string | null }, chunks: { text: string; locator: string }[]): Source {
  const id = newId('src');
  const addedAt = nowIso();
  db.prepare('INSERT INTO sources (id, kind, title, path, hash, origin, added_at, status, chunk_count, chunks_done, extraction) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)').run(
    id,
    input.kind,
    input.title,
    input.path,
    input.hash,
    input.origin ?? null,
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

/**
 * Sources left "being read" by a quit or a crash: nothing is reading them any more. They are marked
 * failed with a plain reason, so the Library offers "Run again" (a source still marked as being read
 * has no such button), and their unfinished parts wait to be read. Returns how many were found.
 */
export function releaseInterruptedSources(db: Database): number {
  db.prepare("UPDATE source_chunks SET status = 'pending' WHERE status = 'running'").run();
  const result = db.prepare("UPDATE sources SET status = 'failed', error = ? WHERE status = 'running'").run('Reading stopped when the app closed. Run it again to finish.');
  return Number(result.changes);
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

export interface PassageHit {
  chunkId: string;
  sourceId: string;
  title: string;
  locator: string;
  /** The passage around the words found, with them in bold. */
  snippet: string;
  text: string;
}

/**
 * Passages of the learner's sources (not session transcripts) that hold any of these words, best
 * first (full-text index `chunk_search`, ranked by BM25). A part that spans pages is narrowed to the
 * page that holds most of the words, so a citation opens where the words are.
 */
export function searchPassages(db: Database, words: string[], limit = 4): PassageHit[] {
  const terms = words.map((w) => w.replace(/"/g, '').trim()).filter(Boolean);
  if (terms.length === 0) return [];
  const match = terms.map((w) => `"${w}"`).join(' OR ');
  const rows = db
    .prepare(
      `SELECT c.id, c.locator, c.text, s.id AS source_id, s.title, snippet(chunk_search, 0, '**', '**', '…', 28) AS snip
       FROM chunk_search JOIN source_chunks c ON c.rowid = chunk_search.rowid JOIN sources s ON s.id = c.source_id
       WHERE chunk_search MATCH ? AND s.kind != 'session'
       ORDER BY bm25(chunk_search) LIMIT ?`,
    )
    .all(match, limit) as { id: string; locator: string; text: string; source_id: string; title: string; snip: string }[];
  return rows.map((r) => {
    const block = blockWithWords(r.text, r.locator, terms);
    return { chunkId: r.id, sourceId: r.source_id, title: r.title, locator: block.locator, snippet: r.snip, text: block.text };
  });
}

/** The page (or section) of a stored part that holds most of these words; the whole part when none does. */
function blockWithWords(text: string, locator: string, terms: string[]): { locator: string; text: string } {
  const blocks = blocksFromParts([{ text, locator }]);
  const words = terms.map((t) => t.toLowerCase());
  const score = (b: { text: string }) => words.filter((w) => b.text.toLowerCase().includes(w)).length;
  let best: { locator: string; text: string } | null = null;
  for (const b of blocks) if (score(b) > 0 && (!best || score(b) > score(best))) best = b;
  return best ?? { locator, text };
}
