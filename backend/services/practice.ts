/**
 * Practice and retention (design §5): the scheduler's picture of a goal, compound practice sets and
 * mock exams, one attempt per problem with the solution shown at once, and grading in the
 * background that turns into practice evidence with implicit credit.
 */
import { generateProblems } from '../agents/problemGenerator';
import type { GeneratorSpec } from '../agents/problemGenerator';
import { gradePractice } from '../agents/grader';
import { ancestors } from '../core/graph';
import { weeklyMinutes } from '../core/budget';
import { leverageOf } from '../core/leverage';
import { chooseMode, dailyMinutes, daysUntil, dueForecast, dueNodes, groupForPractice, mockExamSpecs, mockExamsOpen, specifyProblem } from '../core/scheduler';
import type { DayMode, DueReason, ModeChoice, Presentation, ProblemSpec, ScheduleInput } from '../core/scheduler';
import type { Depth } from '../core/types';
import type { LlmProvider } from '../llm/provider';
import type { Database } from '../store/db';
import { transaction } from '../store/db';
import { logEvent } from '../store/activity';
import { listBugsForNode, recordBug, touchBug } from '../store/bugs';
import { getGoal, listMaterials, listTargets } from '../store/goals';
import { answerFor, closePracticeSet, createPracticeSet, getPracticeSet, getProblem, ideaScoresForProblem, insertAnswer, listProblems, openPracticeSet, practiceCounts, recentStatements, saveGrade, ungradedAnswers } from '../store/practice';
import type { AnswerRecord, PracticeKind } from '../store/practice';
import { getSource, listChunks } from '../store/sources';
import { goalBudgetMinutes } from './budget';
import { normalizeGrade, recordEvidence } from './evidence';
import { loadKnowledge, refreshGoalFields } from './knowledge';
import type { KnowledgeView } from './knowledge';
import { candidatesForGoal } from './planner';

export interface PracticeDeps {
  db: Database;
  provider: LlmProvider;
  /** Told when a grade lands, so the screen can show it. */
  onGraded?: (event: { setId: string; problemId: string }) => void;
  onError?: (message: string) => void;
}

export interface FadingIdea {
  nodeId: string;
  name: string;
  recall: number;
  reason: DueReason;
  recallAtExam: number | null;
}

export interface GoalSchedule {
  goalId: string;
  due: FadingIdea[];
  /** Ideas falling due per day for the next two weeks. */
  forecast: number[];
  mode: DayMode;
  /** One plain sentence: why this mode today. */
  modeReason: string;
  modeValues: ModeChoice['value'];
  dailyMinutes: number;
  daysToExam: number | null;
  mockOpen: boolean;
}

/** Everything a goal reaches: its targets and what they are built on. */
function goalScope(db: Database, goalId: string, view: KnowledgeView): Set<string> {
  const scope = new Set<string>();
  for (const t of listTargets(db, goalId)) {
    if (!view.nodes.has(t.nodeId)) continue;
    scope.add(t.nodeId);
    for (const a of ancestors(t.nodeId, view.index)) scope.add(a);
  }
  return scope;
}

function scheduleInputs(db: Database, view: KnowledgeView, scope?: Set<string>): ScheduleInput[] {
  const counts = practiceCounts(db);
  return [...view.states.values()]
    .filter((s) => (!scope || scope.has(s.nodeId)) && view.nodes.has(s.nodeId))
    .map((s) => ({ nodeId: s.nodeId, depth: s.depth, targetDepth: s.targetDepth, tier: s.tier, fsrs: s.fsrs, practiceCount: counts.get(s.nodeId) ?? 0 }));
}

/** Ideas falling due per day across several goals, each idea counted once. */
export function forecastAcross(db: Database, goalIds: string[], now = new Date(), days = 14): number[] {
  const view = loadKnowledge(db, now);
  const scope = new Set<string>();
  for (const id of goalIds) for (const n of goalScope(db, id, view)) scope.add(n);
  return dueForecast(scheduleInputs(db, view, scope), now, days);
}

const examDateOf = (date: string | null) => (date ? new Date(`${date}T09:00:00`) : null);

export function goalSchedule(db: Database, goalId: string, now = new Date()): GoalSchedule {
  const goal = getGoal(db, goalId);
  if (!goal) throw new Error(`unknown goal ${goalId}`);
  const view = loadKnowledge(db, now);
  const scope = goalScope(db, goalId, view);
  const inputs = scheduleInputs(db, view, scope);
  const examDate = examDateOf(goal.date);
  const due = dueNodes(inputs, now, examDate);
  const { candidates } = candidatesForGoal(db, goalId, view);
  const fringeLeverage = candidates
    .filter((c) => c.onFringe)
    .map((c) => {
      const node = view.nodes.get(c.nodeId);
      return node ? leverageOf(node, view.states.get(c.nodeId), view.index, view.owned, view.goals).leverage : 0;
    })
    .sort((a, b) => b - a);
  const deepenGaps = inputs.filter((n) => view.owned.has(n.nodeId) && n.depth < n.targetDepth).map((n) => n.targetDepth - n.depth);
  const daysToExam = daysUntil(examDate, now);
  const depthOf = (id: string) => view.states.get(id)?.depth ?? 0;
  const choice = chooseMode({ due, depthOf, fringeLeverage, deepenGaps, daysToExam });
  const name = (id: string) => view.nodes.get(id)?.name ?? id;
  const firstFringe = candidates.find((c) => c.onFringe);
  const modeReason =
    choice.mode === 'consolidate'
      ? `${due.length} ${due.length === 1 ? 'idea is' : 'ideas are'} fading; one practice set refreshes them together.`
      : choice.mode === 'deepen'
        ? `${deepenGaps.length} ${deepenGaps.length === 1 ? 'idea you know needs' : 'ideas you know need'} more depth for this goal.`
        : firstFringe
          ? `${fringeLeverage.length} new ${fringeLeverage.length === 1 ? 'idea is' : 'ideas are'} learnable now, starting with ${name(firstFringe.nodeId)}.`
          : 'Nothing new is learnable yet; add material or recompile the goal.';
  return {
    goalId,
    due: due.map((d) => ({ ...d, name: name(d.nodeId) })),
    forecast: dueForecast(inputs, now, 14),
    mode: choice.mode,
    modeReason,
    modeValues: choice.value,
    dailyMinutes: dailyMinutes(weeklyMinutes(goal.budget, goalBudgetMinutes(db, goal), goal.approvedAt ?? goal.createdAt, goal.date)),
    daysToExam,
    mockOpen: mockExamsOpen(goal.assessment, examDate, now),
  };
}

/** What the renderer sees of a set. Solutions appear only once a problem is answered; rubrics never. */
export interface PracticeView {
  id: string;
  kind: PracticeKind;
  goalId: string | null;
  goalTitle: string;
  status: 'open' | 'done';
  problems: PracticeProblemView[];
  /** The first unanswered problem, or null when all are answered. */
  currentIndex: number | null;
}

export interface PracticeProblemView {
  id: string;
  statement: string;
  rung: number;
  cue: number;
  presentation: Presentation;
  answer: { text: string; confidence: number | null } | null;
  solution: string | null;
  /** Null until graded. Score 0–10. */
  grade: { score: number; feedback: string } | null;
  /** The ideas it drew on, revealed with the solution, each with its score once graded. */
  ideas: { nodeId: string; name: string; score: number | null }[] | null;
}

export function practiceView(db: Database, setId: string): PracticeView {
  const set = getPracticeSet(db, setId);
  if (!set) throw new Error(`unknown practice set ${setId}`);
  const goal = set.goalId ? getGoal(db, set.goalId) : undefined;
  const view = loadKnowledge(db);
  const problems = listProblems(db, setId).map((p): PracticeProblemView => {
    const answer = answerFor(db, p.id);
    const ideaScores = answer && answer.score !== null ? ideaScoresForProblem(db, p.id) : new Map<string, number>();
    return {
      id: p.id,
      statement: p.statement,
      rung: p.rung,
      cue: p.cue,
      presentation: p.presentation,
      answer: answer ? { text: answer.answer, confidence: answer.confidence } : null,
      solution: answer ? p.solution : null,
      grade: answer && answer.score !== null ? { score: Math.round(answer.score * 100) / 10, feedback: answer.feedback ?? '' } : null,
      ideas: answer ? p.nodeIds.map((id) => ({ nodeId: id, name: view.nodes.get(id)?.name ?? id, score: ideaScores.get(id) ?? null })) : null,
    };
  });
  const current = problems.findIndex((p) => p.answer === null);
  return { id: set.id, kind: set.kind, goalId: set.goalId, goalTitle: goal?.title ?? goal?.text ?? '', status: set.status, problems, currentIndex: current === -1 ? null : current };
}

export function currentPractice(db: Database): PracticeView | null {
  const set = openPracticeSet(db);
  return set ? practiceView(db, set.id) : null;
}

/** Excerpts of the goal's exercise sheets, so problems look like the course's own. */
function practiceStyle(db: Database, goalId: string): { title: string; text: string }[] {
  return listMaterials(db, goalId)
    .filter((m) => m.role === 'practice')
    .slice(0, 3)
    .map((m) => ({ title: getSource(db, m.sourceId)?.title ?? 'Exercise sheet', text: listChunks(db, m.sourceId).slice(0, 2).map((c) => c.text).join('\n\n').slice(0, 2500) }))
    .filter((p) => p.text.trim());
}

export interface StartPracticeOptions {
  kind?: PracticeKind;
  sessionId?: string | null;
  maxProblems?: number;
  /** Ideas not to practise now (e.g. the ones just taught in this session). */
  exclude?: string[];
  now?: Date;
}

/**
 * Generate and store a practice set for a goal. Compound sets group the goal's fading ideas;
 * mock exams take one problem per taught target. Returns null when there is nothing to practise.
 */
export async function startPractice(deps: PracticeDeps, goalId: string, options: StartPracticeOptions = {}): Promise<PracticeView | null> {
  const { db } = deps;
  const kind = options.kind ?? 'compound';
  const goal = getGoal(db, goalId);
  if (!goal) throw new Error(`unknown goal ${goalId}`);
  const now = options.now ?? new Date();
  const view = loadKnowledge(db, now);
  const exclude = new Set(options.exclude ?? []);
  let specs: ProblemSpec[];
  if (kind === 'mock') {
    const seen = new Set<string>();
    const targets = listTargets(db, goalId)
      .filter((t) => view.nodes.has(t.nodeId) && !seen.has(t.nodeId) && seen.add(t.nodeId))
      .map((t) => ({ nodeId: t.nodeId, targetDepth: t.depth as Depth, depth: view.states.get(t.nodeId)?.depth ?? 0 }));
    specs = mockExamSpecs(targets, options.maxProblems ?? 5);
  } else {
    const inputs = scheduleInputs(db, view, goalScope(db, goalId, view));
    const due = dueNodes(inputs, now, examDateOf(goal.date)).filter((d) => !exclude.has(d.nodeId));
    const groups = groupForPractice(
      due.map((d) => d.nodeId),
      view.index,
      options.maxProblems,
    );
    const byId = new Map(inputs.map((n) => [n.nodeId, n]));
    specs = groups.map((g, i) => specifyProblem(g, byId, goal.assessment, i));
  }
  if (specs.length === 0) return null;

  const generatorSpecs: GeneratorSpec[] = specs.map((s) => ({
    ...s,
    ideas: s.nodeIds.map((id) => {
      const node = view.nodes.get(id);
      const premises = [...new Set((view.index.into.get(id) ?? []).flatMap((c) => c.premises))].map((p) => view.nodes.get(p)?.name ?? p);
      return { id, name: node?.name ?? id, kind: node?.kind ?? 'claim', statement: node?.statement ?? '', ownStatement: view.states.get(id)?.ownStatement ?? null, premises };
    }),
    bugs: s.nodeIds.flatMap((id) => listBugsForNode(db, id).map((b) => b.description)),
  }));
  const problems = await generateProblems(deps.provider, {
    goalText: goal.text,
    assessment: goal.assessment,
    examStyle: goal.examProfile?.summary ?? null,
    practiceStyle: practiceStyle(db, goalId),
    specs: generatorSpecs,
    recent: recentStatements(
      db,
      specs.flatMap((s) => s.nodeIds),
    ),
    mock: kind === 'mock',
  });
  const set = createPracticeSet(db, {
    kind,
    goalId,
    sessionId: options.sessionId ?? null,
    problems: problems.map((p) => {
      const spec = specs[p.index] as ProblemSpec;
      return { nodeIds: spec.nodeIds, rung: spec.rung, cue: spec.cue, presentation: spec.presentation, statement: p.statement, solution: p.solution, rubric: p.rubric };
    }),
  });
  return practiceView(db, set.id);
}

const pending = new Set<Promise<void>>();

/** Resolves when every grade started so far has landed (for tests and orderly shutdown). */
export async function settleGrading(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}

/**
 * One attempt: store the answer and reveal the solution at once; the grade arrives in the
 * background. A second submit for the same problem changes nothing.
 */
export function submitPracticeAnswer(deps: PracticeDeps, problemId: string, answer: string, confidence: number | null): PracticeView {
  const problem = getProblem(deps.db, problemId);
  if (!problem) throw new Error(`unknown problem ${problemId}`);
  if (!answerFor(deps.db, problemId)) {
    const record = insertAnswer(deps.db, problemId, answer, confidence);
    track(deps, record);
  }
  return practiceView(deps.db, problem.setId);
}

function track(deps: PracticeDeps, record: AnswerRecord): void {
  const job = gradeAnswer(deps, record)
    .catch((error: unknown) => deps.onError?.(`Grading failed; it will be retried when the app starts again. ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => pending.delete(job));
  pending.add(job);
}

/** Grade one answer and turn it into practice evidence on each idea, with implicit credit to premises. */
export async function gradeAnswer(deps: PracticeDeps, answer: AnswerRecord): Promise<void> {
  const { db } = deps;
  const problem = getProblem(db, answer.problemId);
  if (!problem) return;
  const set = getPracticeSet(db, problem.setId);
  const view = loadKnowledge(db);
  const grade = await gradePractice(deps.provider, {
    statement: problem.statement,
    solution: problem.solution,
    rubric: problem.rubric,
    ideas: problem.nodeIds.filter((id) => view.nodes.has(id)).map((id) => ({ id, name: view.nodes.get(id)?.name ?? id })),
    answer: answer.answer,
    confidence: answer.confidence,
  });
  transaction(db, () => {
    saveGrade(db, answer.id, normalizeGrade(grade.score), grade.feedback);
    for (const idea of grade.ideas) {
      if (!view.nodes.has(idea.nodeId)) continue;
      recordEvidence(db, {
        nodeId: idea.nodeId,
        kind: 'practice',
        score: normalizeGrade(idea.score),
        reasoning: grade.feedback,
        confidence: answer.confidence,
        context: { rung: problem.rung, cue: problem.cue, problemId: problem.id, step: set?.kind === 'mock' ? 'mock' : 'practice' },
        sessionId: set?.sessionId ?? null,
      });
    }
    if (grade.misconception) {
      const { nodeId, description } = grade.misconception;
      const open = listBugsForNode(db, nodeId).find((b) => b.description.toLowerCase() === description.toLowerCase());
      if (open) touchBug(db, open.id);
      else recordBug(db, nodeId, description);
    }
    if (set && listProblems(db, set.id).every((p) => answerFor(db, p.id)?.score !== null && answerFor(db, p.id) !== undefined)) {
      closePracticeSet(db, set.id);
      logEvent(db, 'practice.done', { goalId: set.goalId, practiceSetId: set.id, sessionId: set.sessionId }, { kind: set.kind });
      refreshGoalFields(db);
    }
  });
  deps.onGraded?.({ setId: problem.setId, problemId: problem.id });
}

/** Grade answers left ungraded when the app last quit. */
export function resumeGrading(deps: PracticeDeps): void {
  for (const answer of ungradedAnswers(deps.db)) track(deps, answer);
}
