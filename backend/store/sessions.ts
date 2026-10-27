import type { Database } from './db';
import { nowIso, parseJson } from './db';
import { newId } from './ids';

export interface SessionRecord<S = Record<string, unknown>> {
  id: string;
  goalId: string | null;
  startedAt: string;
  endedAt: string | null;
  status: 'active' | 'done' | 'abandoned';
  state: S;
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  at: string;
  kind: string;
  payload: Record<string, unknown>;
}

interface SessionRow {
  id: string;
  goal_id: string | null;
  started_at: string;
  ended_at: string | null;
  status: SessionRecord['status'];
  state: string;
}

interface EventRow {
  id: string;
  session_id: string;
  at: string;
  kind: string;
  payload: string;
}

function toSession<S>(r: SessionRow): SessionRecord<S> {
  return { id: r.id, goalId: r.goal_id, startedAt: r.started_at, endedAt: r.ended_at, status: r.status, state: parseJson<S>(r.state, {} as S) };
}

export function createSession<S>(db: Database, goalId: string | null, state: S): SessionRecord<S> {
  const id = newId('sess');
  const startedAt = nowIso();
  db.prepare("INSERT INTO sessions (id, goal_id, started_at, ended_at, status, state) VALUES (?, ?, ?, NULL, 'active', ?)").run(id, goalId, startedAt, JSON.stringify(state));
  return { id, goalId, startedAt, endedAt: null, status: 'active', state };
}

export function getSession<S>(db: Database, id: string): SessionRecord<S> | undefined {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  return row ? toSession<S>(row) : undefined;
}

export function activeSession<S>(db: Database): SessionRecord<S> | undefined {
  const row = db.prepare("SELECT * FROM sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1").get() as SessionRow | undefined;
  return row ? toSession<S>(row) : undefined;
}

export function listSessions<S>(db: Database, limit = 50): SessionRecord<S>[] {
  return (db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?').all(limit) as unknown as SessionRow[]).map((r) => toSession<S>(r));
}

/** Sessions on a goal that have ended (done or ended early), newest first. */
export function listEndedSessions<S>(db: Database, goalId: string, limit = 20): SessionRecord<S>[] {
  return (db.prepare("SELECT * FROM sessions WHERE goal_id = ? AND status != 'active' ORDER BY started_at DESC, rowid DESC LIMIT ?").all(goalId, limit) as unknown as SessionRow[]).map((r) => toSession<S>(r));
}

export function saveSessionState<S>(db: Database, id: string, state: S): void {
  db.prepare('UPDATE sessions SET state = ? WHERE id = ?').run(JSON.stringify(state), id);
}

export function endSession(db: Database, id: string, status: 'done' | 'abandoned'): void {
  db.prepare('UPDATE sessions SET status = ?, ended_at = ? WHERE id = ?').run(status, nowIso(), id);
}

export function appendSessionEvent(db: Database, sessionId: string, kind: string, payload: Record<string, unknown>): SessionEvent {
  const event: SessionEvent = { id: newId('ev'), sessionId, at: nowIso(), kind, payload };
  db.prepare('INSERT INTO session_events (id, session_id, at, kind, payload) VALUES (?, ?, ?, ?, ?)').run(event.id, sessionId, event.at, kind, JSON.stringify(payload));
  return event;
}

export function listSessionEvents(db: Database, sessionId: string): SessionEvent[] {
  return (db.prepare('SELECT * FROM session_events WHERE session_id = ? ORDER BY rowid').all(sessionId) as unknown as EventRow[]).map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    at: r.at,
    kind: r.kind,
    payload: parseJson<Record<string, unknown>>(r.payload, {}),
  }));
}
