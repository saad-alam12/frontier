/**
 * Practice and retention (design §5): the scheduler's picture of a goal, compound practice sets and
 * mock exams, one attempt per problem with the solution shown at once, and grading in the
 * background that turns into practice evidence with implicit credit.
 */
import { generateProblems } from '../agents/problemGenerator';
import type { GeneratorSpec } from '../agents/problemGenerator';
import { gradePractice } from '../agents/grader';
import { ancestorsOfAll } from '../core/graph';
import { leverageOf } from '../core/leverage';
import { chooseMode, dailyMinutes, daysUntil, dueForecast, dueNodes, groupForPractice, mockExamSpecs, mockExamsOpen, specifyProblem, atLevel } from '../core/scheduler';
import type { DayMode, DueReason, ModeChoice, Presentation, ProblemSpec, ScheduleInput, PracticeLevel } from '../core/scheduler';
import { OWNED_DEPTH, PASS_SCORE } from '../core/types';
import type { Depth, Evidence } from '../core/types';
import { listEvidenceOfKind } from '../store/evidence';
import type { LlmImage, LlmProvider } from '../llm/provider';
import { ResponseExtrasSchema } from '../core/attachments';
import type { ResponseExtras } from '../core/attachments';
import type { CodeAnswer, CodeStarter } from '../core/code';
import { attachmentExists, readAttachment } from '../store/attachments';
import type { Database } from '../store/db';
import { transaction } from '../store/db';
import { logEvent } from '../store/activity';
import { listBugsForNode, listOpenBugs } from '../store/bugs';
import { afterAnswer } from './bugs';
import { getGoal, listCapabilities, listMaterials, listTargets } from '../store/goals';
import { answerFor, closePracticeSet, createPracticeSet, getPracticeSet, getProblem, handInPracticeSet, ideaScoresForProblem, insertAnswer, listProblems, openPracticeSet, practiceCounts, recentStatements, saveGrade, ungradedAnswers } from '../store/practice';
import type { AnswerRecord, PracticeKind, ProblemRecord } from '../store/practice';
import { examClock, examMinutes, examReport } from '../core/exam';
import type { ExamReport } from '../core/exam';
import { getSource, listChunks } from '../store/sources';
import { goalRhythm } from './budget';
import { cardsToJudge, creditRecalledCards } from './cards';
import { normalizeGrade, recordEvidence } from './evidence';
import { loadKnowledge, refreshGoalFields } from './knowledge';
import type { KnowledgeView } from './knowledge';
import { candidatesForGoal } from './planner';

export interface PracticeDeps {
  db: Database;
  provider: LlmProvider;
  /** Where answer images and the plots of code runs are kept; needed only when an answer has some. */
  attachmentsDir?: string;
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
  const targeted = listTargets(db, goalId)
    .map((t) => t.nodeId)
    .filter((id) => view.nodes.has(id));
  return new Set([...targeted, ...ancestorsOfAll(targeted, view.index)]);
}

function scheduleInputs(db: Database, view: KnowledgeView, scope?: Set<string>): ScheduleInput[] {
  const counts = practiceCounts(db);
  // the latest sighting of each idea's open misconceptions
  const seen = new Map<string, string>();
  for (const bug of listOpenBugs(db)) if ((seen.get(bug.nodeId) ?? '') < bug.lastSeen) seen.set(bug.nodeId, bug.lastSeen);
  return [...view.states.values()]
    .filter((s) => (!scope || scope.has(s.nodeId)) && view.nodes.has(s.nodeId))
    .map((s) => ({ nodeId: s.nodeId, depth: s.depth, targetDepth: s.targetDepth, tier: s.tier, fsrs: s.fsrs, practiceCount: counts.get(s.nodeId) ?? 0, misconceptionSeen: seen.get(s.nodeId) ?? null }));
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
      return node ? leverageOf(node, view.states.get(c.nodeId), view.index, view.owned, view.goals, view.centrality).leverage : 0;
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
      ? consolidateReason(due)
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
    dailyMinutes: dailyMinutes(goalRhythm(db, goal).weeklyTarget),
    daysToExam,
    mockOpen: mockExamsOpen(goal.assessment, examDate, now),
  };
}

/** Why practice comes first today: ideas fading, and misconceptions waiting for a contrast problem. */
function consolidateReason(due: { reason: string }[]): string {
  const contrast = due.filter((d) => d.reason === 'misconception').length;
  const fading = due.length - contrast;
  const parts = [fading ? `${fading} ${fading === 1 ? 'idea is' : 'ideas are'} fading` : '', contrast ? `${contrast} ${contrast === 1 ? 'idea has a misconception' : 'ideas have misconceptions'} to clear with a contrast problem` : ''].filter(Boolean);
  return `${parts.join(', and ')}; one practice set covers them together.`;
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
  /** A mock exam: its time, whether it is over, and once it is, the report per skill. */
  exam: { minutes: number; endsAt: string; over: boolean; report: ExamReport | null } | null;
}

export interface PracticeProblemView {
  id: string;
  statement: string;
  rung: number;
  cue: number;
  presentation: Presentation;
  answer: { text: string; confidence: number | null; code: CodeAnswer | null; attachments: string[]; quote: string | null } | null;
  /** Starter code when the problem is answered in code. */
  code: CodeStarter | null;
  solution: string | null;
  /** Null until graded. Score 0–10. */
  grade: { score: number; feedback: string } | null;
  /** The ideas it drew on, revealed with the solution, each with its score once graded. */
  ideas: { nodeId: string; name: string; score: number | null }[] | null;
}

export function practiceView(db: Database, setId: string, now = new Date()): PracticeView {
  const set = getPracticeSet(db, setId);
  if (!set) throw new Error(`unknown practice set ${setId}`);
  const goal = set.goalId ? getGoal(db, set.goalId) : undefined;
  const view = loadKnowledge(db);
  const clock = set.minutes !== null ? examClock({ createdAt: set.createdAt, minutes: set.minutes, handedInAt: set.handedInAt }, now) : null;
  const stored = listProblems(db, setId).map((p) => ({ problem: p, answer: answerFor(db, p.id) }));
  const problems = stored.map(({ problem: p, answer }): PracticeProblemView => {
    const ideaScores = answer && answer.score !== null ? ideaScoresForProblem(db, p.id) : new Map<string, number>();
    // an exam shows nothing of the solution or the grade until it is handed in; then every problem's solution shows
    if (clock && !clock.over) {
      return { id: p.id, statement: p.statement, rung: p.rung, cue: p.cue, presentation: p.presentation, answer: answer ? sentAnswer(answer) : null, code: p.code, solution: null, grade: null, ideas: null };
    }
    const shown = Boolean(answer) || Boolean(clock?.over);
    return {
      id: p.id,
      statement: p.statement,
      rung: p.rung,
      cue: p.cue,
      presentation: p.presentation,
      answer: answer ? sentAnswer(answer) : null,
      code: p.code,
      solution: shown ? p.solution : null,
      grade: answer && answer.score !== null ? { score: Math.round(answer.score * 100) / 10, feedback: answer.feedback ?? '' } : null,
      ideas: shown ? p.nodeIds.map((id) => ({ nodeId: id, name: view.nodes.get(id)?.name ?? id, score: ideaScores.get(id) ?? (answer ? null : 0) })) : null,
    };
  });
  const current = problems.findIndex((p) => p.answer === null);
  const exam = clock && set.minutes !== null ? { minutes: set.minutes, endsAt: clock.endsAt, over: clock.over, report: clock.over ? reportFor(db, set.goalId, stored) : null } : null;
  return { id: set.id, kind: set.kind, goalId: set.goalId, goalTitle: goal?.title ?? goal?.text ?? '', status: set.status, problems, currentIndex: clock?.over || current === -1 ? null : current, exam };
}

/** The report of an exam that is over: points, a score per skill of the goal, the ideas to work on. */
function reportFor(db: Database, goalId: string | null, stored: { problem: ProblemRecord; answer: AnswerRecord | undefined }[]): ExamReport {
  const targets = goalId ? listTargets(db, goalId) : [];
  const skills = goalId ? listCapabilities(db, goalId).map((c) => ({ id: c.id, statement: c.statement, nodeIds: targets.filter((t) => t.capabilityId === c.id).map((t) => t.nodeId) })) : [];
  return examReport(
    stored.map(({ problem, answer }) => ({
      nodeIds: problem.nodeIds,
      answered: Boolean(answer),
      score: answer && answer.score !== null ? Math.round(answer.score * 100) / 10 : null,
      ideaScores: answer && answer.score !== null ? ideaScoresForProblem(db, problem.id) : new Map(),
    })),
    skills,
  );
}

/**
 * Hand in an exam: its time stops, and its solutions, grades and report show. Problems left unanswered
 * count zero in the exam's score and write nothing about their ideas, as when leaving practice early.
 */
export function handInExam(db: Database, setId: string, now = new Date()): PracticeView {
  const set = getPracticeSet(db, setId);
  if (!set || set.minutes === null) throw new Error('Only a mock exam is handed in.');
  transaction(db, () => {
    handInPracticeSet(db, setId, now.toISOString());
    closeWhenGraded(db, setId, now);
  });
  return practiceView(db, setId, now);
}

/**
 * A set is done when every problem has a graded answer, or, for an exam that is over, when every
 * answer it got is graded.
 */
function closeWhenGraded(db: Database, setId: string, now = new Date()): boolean {
  const set = getPracticeSet(db, setId);
  if (!set || set.status !== 'open') return false;
  const answers = listProblems(db, set.id).map((p) => answerFor(db, p.id));
  const over = set.minutes !== null && examClock({ createdAt: set.createdAt, minutes: set.minutes, handedInAt: set.handedInAt }, now).over;
  const graded = answers.every((a) => a !== undefined && a.score !== null) || (over && answers.every((a) => a === undefined || a.score !== null));
  if (!graded) return false;
  closePracticeSet(db, set.id);
  logEvent(db, 'practice.done', { goalId: set.goalId, practiceSetId: set.id, sessionId: set.sessionId }, { kind: set.kind });
  refreshGoalFields(db);
  return true;
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
  /** The learner chose what to practise: these ideas now, whether or not they are fading, at this level. */
  focus?: { nodeIds: string[]; level?: PracticeLevel };
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
  } else if (options.focus) {
    // practice is retrieval: only ideas the learner has learned can be practised, the rest are for a session
    const learned = [...new Set(options.focus.nodeIds)].filter((id) => view.nodes.has(id) && (view.states.get(id)?.depth ?? 0) >= OWNED_DEPTH);
    const byId = new Map(scheduleInputs(db, view, new Set(learned)).map((n) => [n.nodeId, n]));
    const level = options.focus.level ?? 'normal';
    specs = groupForPractice(learned, view.index, options.maxProblems).map((g, i) => atLevel(specifyProblem(g, byId, goal.assessment, i), level));
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
    // a mock exam is timed like the real one, about twelve minutes a problem
    minutes: kind === 'mock' ? examMinutes(specs.length, goal.examProfile?.durationMinutes ?? null) : null,
    problems: problems.map((p) => {
      const spec = specs[p.index] as ProblemSpec;
      return { nodeIds: spec.nodeIds, rung: spec.rung, cue: spec.cue, presentation: spec.presentation, statement: p.statement, solution: p.solution, rubric: p.rubric, code: p.code ?? null };
    }),
  });
  return practiceView(db, set.id);
}

const pending = new Set<Promise<void>>();
/** Answers whose grade is being written right now, so a retry never grades one twice. */
const grading = new Set<string>();

/**
 * The goal's ideas whose last practice went wrong: the latest practice answer about each scored below
 * the pass mark. They are worth practising again, on a new problem (the generator is shown the old
 * ones so it does not repeat them); a later pass takes an idea off the list.
 */
export function missedInPractice(db: Database, goalId: string): { nodeId: string; name: string }[] {
  const view = loadKnowledge(db);
  const lastPractice = new Map<string, Evidence>();
  for (const e of listEvidenceOfKind(db, 'practice')) if (!e.context.implicit) lastPractice.set(e.nodeId, e);
  const missed: { nodeId: string; name: string }[] = [];
  for (const nodeId of goalScope(db, goalId, view)) {
    const last = lastPractice.get(nodeId);
    // an idea that fell below "learned" is taught again in a session, not practised
    if (last && last.score < PASS_SCORE && (view.states.get(nodeId)?.depth ?? 0) >= OWNED_DEPTH) missed.push({ nodeId, name: view.nodes.get(nodeId)?.name ?? nodeId });
  }
  return missed.sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolves when every grade started so far has landed (for tests and orderly shutdown). */
export async function settleGrading(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}

/**
 * One attempt: store the answer and reveal the solution at once; the grade arrives in the
 * background. A second submit for the same problem changes nothing.
 */
/** An answer as the learner sent it: the text, its code, the images attached and the part of the problem it replies to. */
function sentAnswer(answer: AnswerRecord): NonNullable<PracticeProblemView['answer']> {
  return { text: answer.answer, confidence: answer.confidence, code: answer.extras.code ?? null, attachments: answer.extras.attachments ?? [], quote: answer.extras.quote ?? null };
}

/** What can go with a practice answer besides its text. */
export interface PracticeExtras {
  code?: CodeAnswer;
  attachments?: string[];
  quote?: string;
}

export function submitPracticeAnswer(deps: PracticeDeps, problemId: string, answer: string, confidence: number | null, extras: PracticeExtras = {}): PracticeView {
  const problem = getProblem(deps.db, problemId);
  if (!problem) throw new Error(`unknown problem ${problemId}`);
  const set = getPracticeSet(deps.db, problem.setId);
  if (set?.minutes != null && examClock({ createdAt: set.createdAt, minutes: set.minutes, handedInAt: set.handedInAt }, new Date()).over) {
    throw new Error('This exam is over: it was handed in or its time ran out.');
  }
  if (!answerFor(deps.db, problemId)) {
    const record = insertAnswer(deps.db, problemId, answer, confidence, checkedExtras(deps, extras));
    track(deps, record);
  }
  return practiceView(deps.db, problem.setId);
}

/** What the renderer sends besides the text is checked here: sizes, and that images and plots are stored files. */
function checkedExtras(deps: PracticeDeps, extras: PracticeExtras): ResponseExtras {
  const parsed = ResponseExtrasSchema.safeParse({
    code: extras.code?.source.trim() ? extras.code : undefined,
    attachments: extras.attachments?.length ? extras.attachments : undefined,
    quote: extras.quote?.trim() ? extras.quote : undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'The answer is not valid.');
  const dir = deps.attachmentsDir;
  const images = parsed.data.attachments ?? [];
  if (images.length && (!dir || !images.every((name) => attachmentExists(dir, name)))) throw new Error('An attached image was not saved. Attach it again.');
  const plots = parsed.data.code?.run?.plots ?? [];
  if (plots.length && (!dir || !plots.every((name) => attachmentExists(dir, name)))) throw new Error('A plot of the run was not saved. Run the code again.');
  return { ...(parsed.data.code ? { code: parsed.data.code } : {}), ...(images.length ? { attachments: images } : {}), ...(parsed.data.quote ? { quote: parsed.data.quote } : {}) };
}

function track(deps: PracticeDeps, record: AnswerRecord): void {
  if (grading.has(record.id)) return;
  grading.add(record.id);
  const job = gradeAnswer(deps, record)
    .catch((error: unknown) => deps.onError?.(`Grading failed; it is tried again when you open practice. ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => {
      grading.delete(record.id);
      pending.delete(job);
    });
  pending.add(job);
}

/**
 * Leave a set: it is closed as it stands. Problems already answered keep their grades (and are still
 * graded if the grade has not arrived); problems not answered write nothing at all, so stopping early
 * never counts against an idea.
 */
export function endPracticeSet(db: Database, setId: string): void {
  const set = getPracticeSet(db, setId);
  if (!set || set.status !== 'open') return;
  transaction(db, () => {
    closePracticeSet(db, set.id);
    logEvent(db, 'practice.done', { goalId: set.goalId, practiceSetId: set.id, sessionId: set.sessionId }, { kind: set.kind, endedEarly: true });
  });
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
    code: answer.extras.code,
    plots: plotsOf(deps, answer.extras.code),
    attachments: storedImages(deps, answer.extras.attachments),
    quote: answer.extras.quote,
    cards: cardsToJudge(db, withPremises(problem.nodeIds, view)),
    misconceptions: problem.nodeIds.flatMap((id) => listBugsForNode(db, id).map((b) => ({ nodeId: id, description: b.description }))),
  });
  transaction(db, () => {
    creditRecalledCards(db, grade.recalledCards, { source: 'practice', sessionId: set?.sessionId ?? null });
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
        // the recall happened when the learner answered, not when the grade arrived (grading can finish days later, after a restart)
        at: answer.submittedAt,
      });
    }
    // the misconception goes on record for its idea; the other ideas were answered without one
    const wrong = grade.misconception;
    for (const nodeId of new Set([...grade.ideas.map((i) => i.nodeId), ...(wrong ? [wrong.nodeId] : [])])) {
      if (view.nodes.has(nodeId)) afterAnswer(db, nodeId, wrong?.nodeId === nodeId ? wrong.description : null, answer.submittedAt);
    }
    if (set) closeWhenGraded(db, set.id);
  });
  deps.onGraded?.({ setId: problem.setId, problemId: problem.id });
}

/** The plots a run of the answer's code drew, for the grader to see; a missing file is left out. */
function plotsOf(deps: PracticeDeps, code: CodeAnswer | undefined): LlmImage[] | undefined {
  return storedImages(deps, code?.run?.plots);
}

/** Stored images by name, read for a model call; ones no longer on disk are left out. */
function storedImages(deps: PracticeDeps, names: string[] | undefined): LlmImage[] | undefined {
  const dir = deps.attachmentsDir;
  if (!dir || !names?.length) return undefined;
  return names.filter((name) => attachmentExists(dir, name)).map((name) => readAttachment(dir, name));
}

/** The problem's ideas, then the ideas they are built on directly: whose flashcards a grade may find recalled. */
function withPremises(nodeIds: string[], view: KnowledgeView): string[] {
  const premises = nodeIds.flatMap((id) => (view.index.into.get(id) ?? []).flatMap((c) => c.premises));
  return [...new Set([...nodeIds, ...premises])].filter((id) => view.nodes.has(id));
}

/** Grade answers that have no grade yet: left by a quit, or by a grade that failed. Answers being graded right now are skipped. */
export function resumeGrading(deps: PracticeDeps): void {
  for (const answer of ungradedAnswers(deps.db)) track(deps, answer);
}
