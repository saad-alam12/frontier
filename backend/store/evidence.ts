/**
 * Evidence (append-only) and the derived node_states table. The evidence service in
 * backend/services/evidence.ts is the only caller of the write functions here.
 */
import type { Database } from './db';
import { nowIso, parseJson } from './db';
import { emptyFsrs } from '../core/fsrs';
import type { Depth, Evidence, EvidenceContext, NodeState, Tier } from '../core/types';

interface EvidenceRow {
  id: string;
  node_id: string;
  at: string;
  kind: Evidence['kind'];
  score: number;
  reasoning: string;
  effort: number | null;
  confidence: number | null;
  context: string;
  session_id: string | null;
}

interface StateRow {
  node_id: string;
  depth: number;
  target_depth: number;
  tier: Tier;
  own_statement: string | null;
  handle: string | null;
  stability: number;
  difficulty: number;
  last_review: string | null;
  due: string | null;
  reps: number;
  lapses: number;
  first_session_id: string | null;
}

function rowToEvidence(r: EvidenceRow): Evidence {
  return {
    id: r.id,
    nodeId: r.node_id,
    at: r.at,
    kind: r.kind,
    score: r.score,
    reasoning: r.reasoning,
    effort: r.effort,
    confidence: r.confidence,
    context: parseJson<EvidenceContext>(r.context, {}),
    sessionId: r.session_id,
  };
}

function rowToState(r: StateRow): NodeState {
  return {
    nodeId: r.node_id,
    depth: r.depth as Depth,
    targetDepth: r.target_depth as Depth,
    tier: r.tier,
    ownStatement: r.own_statement,
    handle: r.handle,
    fsrs: { stability: r.stability, difficulty: r.difficulty, lastReview: r.last_review, due: r.due, reps: r.reps, lapses: r.lapses },
    firstSessionId: r.first_session_id,
  };
}

export function insertEvidence(db: Database, e: Evidence): void {
  db.prepare(
    'INSERT INTO evidence (id, node_id, at, kind, score, reasoning, effort, confidence, context, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(e.id, e.nodeId, e.at, e.kind, e.score, e.reasoning, e.effort, e.confidence, JSON.stringify(e.context), e.sessionId);
}

export function listEvidenceForNode(db: Database, nodeId: string): Evidence[] {
  return (db.prepare('SELECT * FROM evidence WHERE node_id = ? ORDER BY at, id').all(nodeId) as unknown as EvidenceRow[]).map(rowToEvidence);
}

export function listEvidenceForSession(db: Database, sessionId: string): Evidence[] {
  return (db.prepare('SELECT * FROM evidence WHERE session_id = ? ORDER BY at, id').all(sessionId) as unknown as EvidenceRow[]).map(rowToEvidence);
}

export function listEvidenceSince(db: Database, sinceIso: string): Evidence[] {
  return (db.prepare('SELECT * FROM evidence WHERE at >= ? ORDER BY at, id').all(sinceIso) as unknown as EvidenceRow[]).map(rowToEvidence);
}

/** When each idea was first shown at some depth (its first passing evidence). */
export function firstPasses(db: Database, passScore: number): Map<string, string> {
  const rows = db.prepare('SELECT node_id, MIN(at) AS at FROM evidence WHERE score >= ? GROUP BY node_id').all(passScore) as { node_id: string; at: string }[];
  return new Map(rows.map((r) => [r.node_id, r.at]));
}

export function countEvidence(db: Database): number {
  return (db.prepare('SELECT count(*) AS n FROM evidence').get() as { n: number }).n;
}

export function getState(db: Database, nodeId: string): NodeState | undefined {
  const row = db.prepare('SELECT * FROM node_states WHERE node_id = ?').get(nodeId) as StateRow | undefined;
  return row ? rowToState(row) : undefined;
}

export function listStates(db: Database): Map<string, NodeState> {
  const out = new Map<string, NodeState>();
  for (const row of db.prepare('SELECT * FROM node_states').all() as unknown as StateRow[]) out.set(row.node_id, rowToState(row));
  return out;
}

export function emptyState(nodeId: string): NodeState {
  return { nodeId, depth: 0, targetDepth: 0, tier: 'archive', ownStatement: null, handle: null, fsrs: emptyFsrs(), firstSessionId: null };
}

export function upsertState(db: Database, s: NodeState): void {
  db.prepare(
    `INSERT INTO node_states (node_id, depth, target_depth, tier, own_statement, handle, stability, difficulty, last_review, due, reps, lapses, first_session_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(node_id) DO UPDATE SET depth = excluded.depth, target_depth = excluded.target_depth, tier = excluded.tier,
       own_statement = excluded.own_statement, handle = excluded.handle, stability = excluded.stability, difficulty = excluded.difficulty,
       last_review = excluded.last_review, due = excluded.due, reps = excluded.reps, lapses = excluded.lapses,
       first_session_id = excluded.first_session_id, updated_at = excluded.updated_at`,
  ).run(
    s.nodeId,
    s.depth,
    s.targetDepth,
    s.tier,
    s.ownStatement,
    s.handle,
    s.fsrs.stability,
    s.fsrs.difficulty,
    s.fsrs.lastReview,
    s.fsrs.due,
    s.fsrs.reps,
    s.fsrs.lapses,
    s.firstSessionId,
    nowIso(),
  );
}
