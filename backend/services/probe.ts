/**
 * Diagnostic probe (design §3.4): a few high-information questions whose assessment writes evidence,
 * including implied evidence for premises of well-derived nodes. Keys are stored before questions show.
 */
import { assessProbeAnswers, generateProbeQuestions } from '../agents/prober';
import type { Assessment, ProbeCandidate } from '../agents/prober';
import type { ProbeQuestionKind } from '../store/probes';
import { impliedPremiseScores, rankByInformation } from '../core/probe';
import { CommitGate } from '../llm/cancel';
import type { LlmProvider } from '../llm/provider';
import type { Database } from '../store/db';
import { nowIso, transaction } from '../store/db';
import { recordBug } from '../store/bugs';
import { deleteDrafts } from '../store/drafts';
import { getGoal, listTargets } from '../store/goals';
import { closeProbeSet, createProbeSet, getProbeSet, openProbeId, recordProbeAnswer } from '../store/probes';
import { getNodes } from '../store/world';
import { recordEvidence } from './evidence';
import { loadKnowledge } from './knowledge';
import { targetDepthFor } from '../core/leverage';

export const MAX_PROBE_QUESTIONS = 8;

export interface ProbeView {
  id: string;
  goalId: string;
  questions: { problemId: string; nodeId: string; nodeName: string; kind: ProbeQuestionKind; question: string }[];
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
  const all = [...new Set(listTargets(db, goalId).map((t) => t.nodeId))].filter((id) => view.nodes.has(id));
  if (all.length === 0) throw new Error('compile the goal first');
  // Ideas already owned at the depth the plan holds (often learned for another goal) are not asked again.
  const targetIds = all.filter((id) => !(view.owned.has(id) && (view.states.get(id)?.depth ?? 0) >= targetDepthFor(id, view.goals)));
  if (targetIds.length === 0) throw new Error('Nothing to check: you already know every idea this plan holds.');
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
  const questions = await generateProbeQuestions(provider, goal.text, candidates, Math.min(maxQuestions, candidates.length), goal.examProfile?.summary ?? null);
  const set = transaction(db, () => createProbeSet(db, goalId, questions));
  return probeView(db, set.id) as ProbeView;
}

/** The goal's unsubmitted probe, if any, so leaving the screen or quitting the app loses nothing. */
export function openProbe(db: Database, goalId: string): ProbeView | null {
  const id = openProbeId(db, goalId);
  return id ? probeView(db, id) : null;
}

function probeView(db: Database, probeId: string): ProbeView | null {
  const set = getProbeSet(db, probeId);
  if (!set) return null;
  const names = getNodes(db, set.problems.map((p) => p.nodeId));
  return {
    id: set.id,
    goalId: set.goalId ?? '',
    questions: set.problems.map((p) => ({ problemId: p.id, nodeId: p.nodeId, nodeName: names.get(p.nodeId)?.name ?? p.nodeId, kind: p.kind, question: p.question })),
  };
}

/** Draft keys for a probe's questions; the UI saves unsent answers under these. */
export function probeDraftKey(problemId: string): string {
  return `probe:${problemId}`;
}

export interface ProbeAnswerInput {
  problemId: string;
  /** One field: answer and reasoning mixed; empty means no idea. */
  answer: string;
  confidence: number | null;
}

/** Probes being judged. Esc stops the judging; nothing is written before it answers, so the answers stay open. */
const judging = new Map<string, CommitGate>();

export function cancelProbe(probeId: string): boolean {
  return judging.get(probeId)?.cancel() ?? false;
}

export async function submitProbe(db: Database, provider: LlmProvider, probeId: string, answers: ProbeAnswerInput[]): Promise<ProbeOutcome[]> {
  if (judging.has(probeId)) throw new Error('These answers are already being judged.');
  const gate = new CommitGate();
  judging.set(probeId, gate);
  try {
    return await judgeProbe(db, gate.wrap(provider), probeId, answers);
  } finally {
    judging.delete(probeId);
  }
}

async function judgeProbe(db: Database, provider: LlmProvider, probeId: string, answers: ProbeAnswerInput[]): Promise<ProbeOutcome[]> {
  const set = getProbeSet(db, probeId);
  if (!set) throw new Error(`unknown probe ${probeId}`);
  const goalId = set.goalId ?? 'unknown';
  const byProblem = new Map(set.problems.map((p) => [p.id, p]));
  const view = loadKnowledge(db);
  const submittedAt = nowIso();

  const prepared = answers
    .map((a) => {
      const problem = byProblem.get(a.problemId);
      return problem ? { problem, input: a } : null;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  if (prepared.length === 0) throw new Error('no answers matched this probe');

  const assessments = await assessProbeAnswers(
    provider,
    prepared.map((p) => ({
      nodeId: p.problem.nodeId,
      question: p.problem.question,
      answerKey: p.problem.answerKey,
      rubric: p.problem.rubric,
      answer: p.input.answer,
      confidence: p.input.confidence,
    })),
  );
  const byNode = new Map<string, Assessment>(assessments.map((a) => [a.nodeId, a]));

  return transaction(db, () => {
    const outcomes: ProbeOutcome[] = [];
    for (const { problem, input } of prepared) {
      const a = byNode.get(problem.nodeId);
      if (!a) continue;
      recordProbeAnswer(db, { problemId: problem.id, answer: input.answer, confidence: input.confidence, score: a.score, feedback: a.reasoning, submittedAt });
      recordEvidence(db, {
        nodeId: problem.nodeId,
        kind: problem.kind,
        score: a.score,
        reasoning: a.reasoning,
        confidence: input.confidence,
        context: { step: `probe:${goalId}`, problemId: problem.id },
      });
      if (a.misconception) recordBug(db, problem.nodeId, a.misconception);
      const implied: ProbeOutcome['impliedPremises'] = [];
      for (const [premiseId, score] of impliedPremiseScores(problem.nodeId, a.score, problem.kind, view.index)) {
        if (!view.nodes.has(premiseId)) continue;
        recordEvidence(db, {
          nodeId: premiseId,
          kind: 'check',
          score,
          reasoning: `Implied by a correct ${problem.kind} of ${view.nodes.get(problem.nodeId)?.name ?? problem.nodeId} in the probe`,
          context: { step: `probe-implied:${goalId}`, problemId: problem.id },
        });
        implied.push({ nodeId: premiseId, nodeName: view.nodes.get(premiseId)?.name ?? premiseId, score });
      }
      outcomes.push({ nodeId: problem.nodeId, nodeName: view.nodes.get(problem.nodeId)?.name ?? problem.nodeId, score: a.score, reasoning: a.reasoning, misconception: a.misconception, impliedPremises: implied });
    }
    closeProbeSet(db, probeId);
    deleteDrafts(db, set.problems.map((p) => probeDraftKey(p.id)));
    return outcomes;
  });
}
