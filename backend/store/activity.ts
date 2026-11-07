import type { Database } from './db';
import { parseJson } from './db';
import { newId } from './ids';

/**
 * The activity log (design §10.2): what the learner does and for how long. Time arrives as ticks and
 * is stored as spans: a tick that continues the latest span of the same activity extends it, anything
 * else opens a new one. Events (a lookup, a budget change, an idea reaching a new depth) are rows with
 * no time.
 */
export type ActivityKind =
  | 'time'
  | 'goal.created'
  | 'goal.approved'
  | 'goal.extended'
  | 'budget.changed'
  | 'material.added'
  | 'session.started'
  | 'session.ended'
  | 'practice.done'
  | 'lookup'
  | 'depth.changed'
  | 'pace';

/**
 * Where time was spent. `free`: a session the learner chose, booked to no goal (free study). `cards`:
 * flashcard review, booked to the card's goal when it has one.
 */
export type Surface = 'session' | 'practice' | 'probe' | 'cards' | 'lookup' | 'map' | 'reading' | 'free';

export interface ActivityContext {
  goalId?: string | null;
  sessionId?: string | null;
  practiceSetId?: string | null;
  nodeId?: string | null;
  sourceId?: string | null;
}

export interface Activity extends Required<ActivityContext> {
  id: string;
  at: string;
  endedAt: string;
  kind: ActivityKind;
  seconds: number;
  data: Record<string, unknown>;
}

interface ActivityRow {
  id: string;
  at: string;
  ended_at: string;
  kind: ActivityKind;
  seconds: number;
  goal_id: string | null;
  session_id: string | null;
  practice_set_id: string | null;
  node_id: string | null;
  source_id: string | null;
  data: string;
}

const toActivity = (r: ActivityRow): Activity => ({
  id: r.id,
  at: r.at,
  endedAt: r.ended_at,
  kind: r.kind,
  seconds: r.seconds,
  goalId: r.goal_id,
  sessionId: r.session_id,
  practiceSetId: r.practice_set_id,
  nodeId: r.node_id,
  sourceId: r.source_id,
  data: parseJson<Record<string, unknown>>(r.data, {}),
});

/** A gap longer than this between ticks starts a new span. */
const SPAN_GAP_MS = 45_000;

export function logEvent(db: Database, kind: Exclude<ActivityKind, 'time'>, context: ActivityContext = {}, data: Record<string, unknown> = {}, at = new Date()): void {
  const iso = at.toISOString();
  db.prepare('INSERT INTO activity (id, at, ended_at, kind, seconds, goal_id, session_id, practice_set_id, node_id, source_id, data) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)').run(
    newId('act'),
    iso,
    iso,
    kind,
    context.goalId ?? null,
    context.sessionId ?? null,
    context.practiceSetId ?? null,
    context.nodeId ?? null,
    context.sourceId ?? null,
    JSON.stringify(data),
  );
}

/** Add `seconds` of active time ending at `at` to the span of this activity, or open a new span. */
export function logTime(db: Database, surface: Surface, context: ActivityContext, seconds: number, at = new Date()): void {
  const last = db.prepare("SELECT * FROM activity WHERE kind = 'time' ORDER BY ended_at DESC, rowid DESC LIMIT 1").get() as ActivityRow | undefined;
  const same =
    last &&
    parseJson<{ surface?: string }>(last.data, {}).surface === surface &&
    last.goal_id === (context.goalId ?? null) &&
    last.session_id === (context.sessionId ?? null) &&
    last.practice_set_id === (context.practiceSetId ?? null) &&
    last.node_id === (context.nodeId ?? null) &&
    last.source_id === (context.sourceId ?? null) &&
    at.getTime() >= new Date(last.ended_at).getTime() &&
    at.getTime() - new Date(last.ended_at).getTime() <= SPAN_GAP_MS;
  if (same) {
    db.prepare('UPDATE activity SET ended_at = ?, seconds = seconds + ? WHERE id = ?').run(at.toISOString(), seconds, last.id);
    return;
  }
  const start = new Date(at.getTime() - seconds * 1000).toISOString();
  db.prepare("INSERT INTO activity (id, at, ended_at, kind, seconds, goal_id, session_id, practice_set_id, node_id, source_id, data) VALUES (?, ?, ?, 'time', ?, ?, ?, ?, ?, ?, ?)").run(
    newId('act'),
    start,
    at.toISOString(),
    seconds,
    context.goalId ?? null,
    context.sessionId ?? null,
    context.practiceSetId ?? null,
    context.nodeId ?? null,
    context.sourceId ?? null,
    JSON.stringify({ surface }),
  );
}

export function listActivity(db: Database, options: { kinds?: ActivityKind[]; since?: string } = {}): Activity[] {
  const where: string[] = [];
  const args: string[] = [];
  if (options.kinds?.length) {
    where.push(`kind IN (${options.kinds.map(() => '?').join(', ')})`);
    args.push(...options.kinds);
  }
  if (options.since) {
    where.push('ended_at >= ?');
    args.push(options.since);
  }
  const sql = `SELECT * FROM activity${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY at, rowid`;
  return (db.prepare(sql).all(...args) as unknown as ActivityRow[]).map(toActivity);
}

/** Active seconds booked to an idea within the given sessions (its time so far). */
export function secondsOnNode(db: Database, sessionIds: string[], nodeId: string): number {
  if (sessionIds.length === 0) return 0;
  const row = db
    .prepare(`SELECT COALESCE(SUM(seconds), 0) AS s FROM activity WHERE kind = 'time' AND node_id = ? AND session_id IN (${sessionIds.map(() => '?').join(', ')})`)
    .get(nodeId, ...sessionIds) as { s: number };
  return row.s;
}
