/** Practice sets (compound practice and mock exams): problems with committed solutions, and answers. */
import type { Presentation } from '../core/scheduler';
import type { Database } from './db';
import { nowIso, parseJson } from './db';
import { newId } from './ids';

export type PracticeKind = 'compound' | 'mock';

export interface PracticeSetRecord {
  id: string;
  kind: PracticeKind;
  goalId: string | null;
  sessionId: string | null;
  createdAt: string;
  status: 'open' | 'done';
}

export interface ProblemRecord {
  id: string;
  setId: string;
  nodeIds: string[];
  rung: number;
  cue: number;
  presentation: Presentation;
  statement: string;
  solution: string;
  rubric: string[];
  createdAt: string;
}

export interface AnswerRecord {
  id: string;
  problemId: string;
  submittedAt: string;
  answer: string;
  confidence: number | null;
  score: number | null;
  feedback: string | null;
  gradedAt: string | null;
}

interface SetRow {
  id: string;
  kind: PracticeKind;
  goal_id: string | null;
  session_id: string | null;
  created_at: string;
  status: 'open' | 'done';
}
interface ProblemRow {
  id: string;
  set_id: string;
  node_ids: string;
  rung: number;
  cue: number;
  presentation: Presentation;
  statement: string;
  solution: string;
  rubric: string;
  created_at: string;
}
interface AnswerRow {
  id: string;
  problem_id: string;
  submitted_at: string;
  answer: string;
  confidence: number | null;
  score: number | null;
  feedback: string | null;
  graded_at: string | null;
}

const toSet = (r: SetRow): PracticeSetRecord => ({ id: r.id, kind: r.kind, goalId: r.goal_id, sessionId: r.session_id, createdAt: r.created_at, status: r.status });
const toProblem = (r: ProblemRow): ProblemRecord => ({
  id: r.id,
  setId: r.set_id,
  nodeIds: parseJson<string[]>(r.node_ids, []),
  rung: r.rung,
  cue: r.cue,
  presentation: r.presentation,
  statement: r.statement,
  solution: r.solution,
  rubric: parseJson<string[]>(r.rubric, []),
  createdAt: r.created_at,
});
const toAnswer = (r: AnswerRow): AnswerRecord => ({
  id: r.id,
  problemId: r.problem_id,
  submittedAt: r.submitted_at,
  answer: r.answer,
  confidence: r.confidence,
  score: r.score,
  feedback: r.feedback,
  gradedAt: r.graded_at,
});

/** Store a set and its problems, solutions and rubrics before any problem is shown (commit before pose). */
export function createPracticeSet(
  db: Database,
  input: { kind: PracticeKind; goalId: string | null; sessionId: string | null; problems: Omit<ProblemRecord, 'id' | 'setId' | 'createdAt'>[] },
): PracticeSetRecord {
  const id = newId('pset');
  const at = nowIso();
  const nodeIds = [...new Set(input.problems.flatMap((p) => p.nodeIds))];
  db.prepare("INSERT INTO practice_sets (id, created_at, kind, goal_id, node_ids, status, session_id) VALUES (?, ?, ?, ?, ?, 'open', ?)").run(id, at, input.kind, input.goalId, JSON.stringify(nodeIds), input.sessionId);
  const insert = db.prepare('INSERT INTO problems (id, set_id, session_id, created_at, node_ids, rung, cue, presentation, statement, solution, rubric) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const p of input.problems) insert.run(newId('prob'), id, input.sessionId, at, JSON.stringify(p.nodeIds), p.rung, p.cue, p.presentation, p.statement, p.solution, JSON.stringify(p.rubric));
  return { id, kind: input.kind, goalId: input.goalId, sessionId: input.sessionId, createdAt: at, status: 'open' };
}

export function getPracticeSet(db: Database, id: string): PracticeSetRecord | undefined {
  const row = db.prepare("SELECT * FROM practice_sets WHERE id = ? AND kind IN ('compound', 'mock')").get(id) as SetRow | undefined;
  return row ? toSet(row) : undefined;
}

/** The newest open set outside sessions (sessions keep their own set in their state). */
export function openPracticeSet(db: Database): PracticeSetRecord | undefined {
  const row = db.prepare("SELECT * FROM practice_sets WHERE status = 'open' AND kind IN ('compound', 'mock') AND session_id IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1").get() as SetRow | undefined;
  return row ? toSet(row) : undefined;
}

export function listPracticeSets(db: Database, limit = 50): PracticeSetRecord[] {
  return (db.prepare("SELECT * FROM practice_sets WHERE kind IN ('compound', 'mock') ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit) as unknown as SetRow[]).map(toSet);
}

/** Ideas asked about in a set that is still open (practice, mock or probe). */
export function nodesInOpenSets(db: Database): Set<string> {
  const rows = db.prepare("SELECT node_ids FROM practice_sets WHERE status = 'open'").all() as { node_ids: string }[];
  return new Set(rows.flatMap((r) => parseJson<string[]>(r.node_ids, [])));
}

export function closePracticeSet(db: Database, id: string): void {
  db.prepare("UPDATE practice_sets SET status = 'done' WHERE id = ?").run(id);
}

export function listProblems(db: Database, setId: string): ProblemRecord[] {
  return (db.prepare('SELECT * FROM problems WHERE set_id = ? ORDER BY rowid').all(setId) as unknown as ProblemRow[]).map(toProblem);
}

export function getProblem(db: Database, id: string): ProblemRecord | undefined {
  const row = db.prepare('SELECT * FROM problems WHERE id = ?').get(id) as ProblemRow | undefined;
  return row ? toProblem(row) : undefined;
}

export function insertAnswer(db: Database, problemId: string, answer: string, confidence: number | null): AnswerRecord {
  const record: AnswerRecord = { id: newId('ans'), problemId, submittedAt: nowIso(), answer, confidence, score: null, feedback: null, gradedAt: null };
  db.prepare('INSERT INTO answers (id, problem_id, submitted_at, answer, confidence) VALUES (?, ?, ?, ?, ?)').run(record.id, problemId, record.submittedAt, answer, confidence);
  return record;
}

export function answerFor(db: Database, problemId: string): AnswerRecord | undefined {
  const row = db.prepare('SELECT * FROM answers WHERE problem_id = ? ORDER BY rowid DESC LIMIT 1').get(problemId) as AnswerRow | undefined;
  return row ? toAnswer(row) : undefined;
}

export function saveGrade(db: Database, answerId: string, score: number, feedback: string): void {
  db.prepare('UPDATE answers SET score = ?, feedback = ?, graded_at = ? WHERE id = ?').run(score, feedback, nowIso(), answerId);
}

/** Practice answers still waiting for a grade (e.g. the app quit while grading). */
export function ungradedAnswers(db: Database): AnswerRecord[] {
  return (
    db
      .prepare("SELECT a.* FROM answers a JOIN problems p ON p.id = a.problem_id JOIN practice_sets s ON s.id = p.set_id WHERE a.score IS NULL AND s.kind IN ('compound', 'mock') ORDER BY a.rowid")
      .all() as unknown as AnswerRow[]
  ).map(toAnswer);
}

/** Recent problem statements that touched any of these ideas, newest first. */
export function recentStatements(db: Database, nodeIds: string[], limit = 12): string[] {
  if (nodeIds.length === 0) return [];
  const wanted = new Set(nodeIds);
  const rows = db.prepare("SELECT p.statement, p.node_ids FROM problems p JOIN practice_sets s ON s.id = p.set_id WHERE s.kind IN ('compound', 'mock') ORDER BY p.rowid DESC LIMIT 200").all() as { statement: string; node_ids: string }[];
  return rows.filter((r) => parseJson<string[]>(r.node_ids, []).some((id) => wanted.has(id))).slice(0, limit).map((r) => r.statement);
}

/** Passing, non-implicit practice evidence per idea: how practised each one is. */
export function practiceCounts(db: Database): Map<string, number> {
  const rows = db
    .prepare("SELECT node_id, COUNT(*) AS n FROM evidence WHERE kind = 'practice' AND score >= 0.7 AND json_extract(context, '$.implicit') IS NULL GROUP BY node_id")
    .all() as { node_id: string; n: number }[];
  return new Map(rows.map((r) => [r.node_id, Number(r.n)]));
}

/** Per-idea scores (0–10) of a graded problem, read back from its practice evidence. */
export function ideaScoresForProblem(db: Database, problemId: string): Map<string, number> {
  const rows = db
    .prepare("SELECT node_id, score FROM evidence WHERE kind = 'practice' AND json_extract(context, '$.problemId') = ? AND json_extract(context, '$.implicit') IS NULL")
    .all(problemId) as { node_id: string; score: number }[];
  return new Map(rows.map((r) => [r.node_id, Math.round(r.score * 100) / 10]));
}
