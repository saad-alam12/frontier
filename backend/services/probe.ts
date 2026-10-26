/**
 * Diagnostic probe (design §3.4): a few high-information questions whose assessment writes evidence,
 * including implied evidence for premises of well-derived nodes. Keys are stored before questions show.
 */
import { assessProbeAnswers, generateProbeQuestions } from '../agents/prober';
import type { Assessment, ProbeCandidate, ProbeQuestion } from '../agents/prober';
import { impliedPremiseScores, rankByInformation } from '../core/probe';
import type { LlmProvider } from '../llm/provider';
import type { Database } from '../store/db';
import { nowIso, parseJson, transaction } from '../store/db';
import { recordBug } from '../store/bugs';
import { getGoal, listTargets } from '../store/goals';
import { newId } from '../store/ids';
import { recordEvidence } from './evidence';
import { loadKnowledge } from './knowledge';
import { targetDepthFor } from '../core/leverage';

export const MAX_PROBE_QUESTIONS = 8;

export interface ProbeView {
  id: string;
  goalId: string;
  questions: { problemId: string; nodeId: string; nodeName: string; kind: ProbeQuestion['kind']; question: string }[];
}

export interface ProbeOutcome {
  nodeId: string;
  nodeName: string;
  score: number;
  reasoning: string;
  misconception: string | null;
  impliedPremises: { nodeId: string; nodeName: string; score: number }[];
}

export async function createProbe(db: Database, provider: LlmProvider, goalId: string, maxQuestions = MAX_PROBE_QUESTIONS): Promise<ProbeView> {
  const goal = getGoal(db, goalId);
  if (!goal) throw new Error(`unknown goal ${goalId}`);
  const view = loadKnowledge(db);
  const targetIds = [...new Set(listTargets(db, goalId).map((t) => t.nodeId))].filter((id) => view.nodes.has(id));
  if (targetIds.length === 0) throw new Error('compile the goal first');
  const ranked = rankByInformation(targetIds, view.index).slice(0, Math.max(maxQuestions * 2, 8));
  const candidates: ProbeCandidate[] = ranked.map((r) => {
    const node = view.nodes.get(r.nodeId);
    const premises = new Map<string, string>();
    for (const chain of view.index.into.get(r.nodeId) ?? []) for (const p of chain.premises) premises.set(p, view.nodes.get(p)?.name ?? p);
    return {
      nodeId: r.nodeId,
      kind: node?.kind ?? 'claim',
      name: node?.name ?? r.nodeId,
      statement: node?.statement ?? '',
      information: r.information,
      premises: [...premises.entries()].map(([id, name]) => ({ id, name })),
      currentDepth: view.states.get(r.nodeId)?.depth ?? 0,
      targetDepth: targetDepthFor(r.nodeId, view.goals),
    };
  });
  const questions = await generateProbeQuestions(provider, goal.text, candidates, Math.min(maxQuestions, candidates.length));

  return transaction(db, () => {
    const setId = newId('probe');
    const now = nowIso();
    db.prepare("INSERT INTO practice_sets (id, created_at, kind, goal_id, node_ids, status) VALUES (?, ?, 'probe', ?, ?, 'open')").run(setId, now, goalId, JSON.stringify(questions.map((q) => q.nodeId)));
    const insert = db.prepare(
      "INSERT INTO problems (id, set_id, session_id, created_at, node_ids, rung, cue, presentation, statement, solution, rubric) VALUES (?, ?, NULL, ?, ?, ?, 0, 'theory', ?, ?, ?)",
    );
    const out: ProbeView['questions'] = [];
    for (const q of questions) {
      const problemId = newId('prob');
      insert.run(problemId, setId, now, JSON.stringify([q.nodeId]), q.kind === 'use' ? 2 : 1, q.question, q.answerKey, JSON.stringify({ kind: q.kind, rubric: q.rubric }));
      out.push({ problemId, nodeId: q.nodeId, nodeName: view.nodes.get(q.nodeId)?.name ?? q.nodeId, kind: q.kind, question: q.question });
    }
    return { id: setId, goalId, questions: out };
  });
}

export interface ProbeAnswerInput {
  problemId: string;
  answer: string;
  confidence: number;
  thinkAloud: string;
}

interface ProblemRow {
  id: string;
  node_ids: string;
  statement: string;
  solution: string;
  rubric: string;
}

export async function submitProbe(db: Database, provider: LlmProvider, probeId: string, answers: ProbeAnswerInput[]): Promise<ProbeOutcome[]> {
  const set = db.prepare("SELECT goal_id FROM practice_sets WHERE id = ? AND kind = 'probe'").get(probeId) as { goal_id: string | null } | undefined;
  if (!set) throw new Error(`unknown probe ${probeId}`);
  const goalId = set.goal_id ?? 'unknown';
  const rows = db.prepare('SELECT id, node_ids, statement, solution, rubric FROM problems WHERE set_id = ?').all(probeId) as unknown as ProblemRow[];
  const byProblem = new Map(rows.map((r) => [r.id, r]));
  const view = loadKnowledge(db);
  const submittedAt = nowIso();

  const prepared = answers
    .map((a) => {
      const row = byProblem.get(a.problemId);
      if (!row) return null;
      const meta = parseJson<{ kind: 'check' | 'derive' | 'use'; rubric: string[] }>(row.rubric, { kind: 'check', rubric: [] });
      const nodeId = parseJson<string[]>(row.node_ids, [])[0] as string;
      return { row, meta, nodeId, input: a };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  if (prepared.length === 0) throw new Error('no answers matched this probe');

  const assessments = await assessProbeAnswers(
    provider,
    prepared.map((p) => ({
      nodeId: p.nodeId,
      question: p.row.statement,
      answerKey: p.row.solution,
      rubric: p.meta.rubric,
      answer: p.input.answer,
      confidence: p.input.confidence,
      thinkAloud: p.input.thinkAloud,
    })),
  );
  const byNode = new Map<string, Assessment>(assessments.map((a) => [a.nodeId, a]));

  return transaction(db, () => {
    const insertAnswer = db.prepare(
      'INSERT INTO answers (id, problem_id, submitted_at, answer, think_aloud, confidence, score, feedback, graded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const outcomes: ProbeOutcome[] = [];
    for (const p of prepared) {
      const a = byNode.get(p.nodeId);
      if (!a) continue;
      insertAnswer.run(newId('ans'), p.row.id, submittedAt, p.input.answer, p.input.thinkAloud, p.input.confidence, a.score, a.reasoning, nowIso());
      recordEvidence(db, {
        nodeId: p.nodeId,
        kind: p.meta.kind,
        score: a.score,
        reasoning: a.reasoning,
        confidence: p.input.confidence,
        context: { step: `probe:${goalId}`, problemId: p.row.id },
      });
      if (a.misconception) recordBug(db, p.nodeId, a.misconception);
      const implied: ProbeOutcome['impliedPremises'] = [];
      for (const [premiseId, score] of impliedPremiseScores(p.nodeId, a.score, p.meta.kind, view.index)) {
        if (!view.nodes.has(premiseId)) continue;
        recordEvidence(db, {
          nodeId: premiseId,
          kind: 'check',
          score,
          reasoning: `Implied by a correct ${p.meta.kind} of ${view.nodes.get(p.nodeId)?.name ?? p.nodeId} in the probe`,
          context: { step: `probe-implied:${goalId}`, problemId: p.row.id },
        });
        implied.push({ nodeId: premiseId, nodeName: view.nodes.get(premiseId)?.name ?? premiseId, score });
      }
      outcomes.push({ nodeId: p.nodeId, nodeName: view.nodes.get(p.nodeId)?.name ?? p.nodeId, score: a.score, reasoning: a.reasoning, misconception: a.misconception, impliedPremises: implied });
    }
    db.prepare("UPDATE practice_sets SET status = 'done' WHERE id = ?").run(probeId);
    return outcomes;
  });
}
