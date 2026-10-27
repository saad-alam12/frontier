/** Probe sets: a practice set of kind `probe` with its problems (keys and rubrics) and answers. */
import type { Database } from './db';
import { nowIso, parseJson } from './db';
import { newId } from './ids';

export type ProbeQuestionKind = 'check' | 'derive' | 'use';

export interface ProbeProblem {
  id: string;
  nodeId: string;
  kind: ProbeQuestionKind;
  question: string;
  answerKey: string;
  rubric: string[];
}

interface ProblemRow {
  id: string;
  node_ids: string;
  statement: string;
  solution: string;
  rubric: string;
}

function toProblem(r: ProblemRow): ProbeProblem {
  const meta = parseJson<{ kind: ProbeQuestionKind; rubric: string[] }>(r.rubric, { kind: 'check', rubric: [] });
  return { id: r.id, nodeId: parseJson<string[]>(r.node_ids, [])[0] ?? '', kind: meta.kind, question: r.statement, answerKey: r.solution, rubric: meta.rubric };
}

/** Store a probe and its questions with keys before any question is shown (commit before pose). */
export function createProbeSet(db: Database, goalId: string, questions: Omit<ProbeProblem, 'id'>[]): { id: string; problems: ProbeProblem[] } {
  const setId = newId('probe');
  const now = nowIso();
  db.prepare("INSERT INTO practice_sets (id, created_at, kind, goal_id, node_ids, status) VALUES (?, ?, 'probe', ?, ?, 'open')").run(setId, now, goalId, JSON.stringify(questions.map((q) => q.nodeId)));
  const insert = db.prepare(
    "INSERT INTO problems (id, set_id, session_id, created_at, node_ids, rung, cue, presentation, statement, solution, rubric) VALUES (?, ?, NULL, ?, ?, ?, 0, 'theory', ?, ?, ?)",
  );
  const problems = questions.map((q) => {
    const id = newId('prob');
    insert.run(id, setId, now, JSON.stringify([q.nodeId]), q.kind === 'use' ? 2 : 1, q.question, q.answerKey, JSON.stringify({ kind: q.kind, rubric: q.rubric }));
    return { ...q, id };
  });
  return { id: setId, problems };
}

export function getProbeSet(db: Database, probeId: string): { id: string; goalId: string | null; status: string; problems: ProbeProblem[] } | undefined {
  const set = db.prepare("SELECT id, goal_id, status FROM practice_sets WHERE id = ? AND kind = 'probe'").get(probeId) as { id: string; goal_id: string | null; status: string } | undefined;
  if (!set) return undefined;
  const rows = db.prepare('SELECT id, node_ids, statement, solution, rubric FROM problems WHERE set_id = ? ORDER BY rowid').all(probeId) as unknown as ProblemRow[];
  return { id: set.id, goalId: set.goal_id, status: set.status, problems: rows.map(toProblem) };
}

/** The newest unsubmitted probe for a goal. */
export function openProbeId(db: Database, goalId: string): string | null {
  const row = db.prepare("SELECT id FROM practice_sets WHERE kind = 'probe' AND goal_id = ? AND status = 'open' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(goalId) as { id: string } | undefined;
  return row?.id ?? null;
}

export function recordProbeAnswer(db: Database, input: { problemId: string; answer: string; confidence: number | null; score: number; feedback: string; submittedAt: string }): void {
  db.prepare('INSERT INTO answers (id, problem_id, submitted_at, answer, confidence, score, feedback, graded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    newId('ans'),
    input.problemId,
    input.submittedAt,
    input.answer,
    input.confidence,
    input.score,
    input.feedback,
    nowIso(),
  );
}

export function closeProbeSet(db: Database, probeId: string): void {
  db.prepare("UPDATE practice_sets SET status = 'done' WHERE id = ?").run(probeId);
}
