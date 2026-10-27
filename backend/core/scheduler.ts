/**
 * The scheduler (design §5.2, §6): which ideas are fading, how they group into compound problems,
 * how each problem is specified (rung, cue distance, presentation), and whether today should build,
 * deepen or consolidate. Pure: every input is passed in, including the time.
 */
import { isDue, recallProbability } from './fsrs';
import type { GraphIndex } from './graph';
import type { Assessment, Depth, FsrsState, Tier } from './types';

/** Below this predicted recall an idea counts as fading, even before its FSRS due date. */
export const FADING_RECALL = 0.85;
/** In the last weeks before an exam, aim for at least this recall on the exam day. */
export const EXAM_RECALL = 0.9;
export const EXAM_WINDOW_DAYS = 21;
export const MOCK_WINDOW_DAYS = 28;
export const MAX_PER_PROBLEM = 3;
export const MAX_SET_PROBLEMS = 4;
/** Ideas this many hops apart or closer (along chains, either way) can share a problem. */
export const GROUP_DISTANCE = 3;
const DAY_MS = 86_400_000;

export interface ScheduleInput {
  nodeId: string;
  depth: Depth;
  targetDepth: Depth;
  tier: Tier;
  fsrs: FsrsState;
  /** Passing practice evidence so far (not implicit credit): drives cue distance and rung. */
  practiceCount: number;
}

export type DueReason = 'due' | 'fading' | 'exam';

export interface DueNode {
  nodeId: string;
  recall: number;
  /** Predicted recall on the exam day, when an exam is in the window. */
  recallAtExam: number | null;
  reason: DueReason;
}

/**
 * Practice maintains what was learned past recognition and is still needed: depth 2 or more,
 * a goal wants depth 2 or more, and the idea is not archived. Everything else may decay to the
 * index tier on purpose (design §5.2, "let go deliberately").
 */
export function isMaintained(n: ScheduleInput): boolean {
  return n.fsrs.lastReview !== null && n.depth >= 2 && n.targetDepth >= 2 && n.tier !== 'archive';
}

/**
 * Ideas to practise now, most faded first. An idea is due on its FSRS date or once its recall
 * drops below FADING_RECALL. Within EXAM_WINDOW_DAYS of an exam, an idea is also due when its
 * recall on the exam day would fall short of EXAM_RECALL (and it was not reviewed in the last day),
 * so recall peaks on the date.
 */
export function dueNodes(nodes: ScheduleInput[], now: Date, examDate: Date | null = null): DueNode[] {
  const examInWindow = examDate !== null && examDate.getTime() > now.getTime() && examDate.getTime() - now.getTime() <= EXAM_WINDOW_DAYS * DAY_MS;
  const out: DueNode[] = [];
  for (const n of nodes) {
    if (!isMaintained(n)) continue;
    const recall = recallProbability(n.fsrs, now);
    const recallAtExam = examInWindow && examDate ? recallProbability(n.fsrs, examDate) : null;
    const reviewedToday = n.fsrs.lastReview !== null && now.getTime() - new Date(n.fsrs.lastReview).getTime() < DAY_MS;
    let reason: DueReason | null = null;
    if (isDue(n.fsrs, now)) reason = 'due';
    else if (recall < FADING_RECALL) reason = 'fading';
    else if (recallAtExam !== null && recallAtExam < EXAM_RECALL && !reviewedToday) reason = 'exam';
    if (reason) out.push({ nodeId: n.nodeId, recall, recallAtExam, reason });
  }
  return out.sort((a, b) => a.recall - b.recall || a.nodeId.localeCompare(b.nodeId));
}

/** How many maintained ideas fall due on each of the next `days` days (day 0 includes overdue ones). */
export function dueForecast(nodes: ScheduleInput[], now: Date, days = 7): number[] {
  const counts = new Array<number>(days).fill(0);
  for (const n of nodes) {
    if (!isMaintained(n) || !n.fsrs.due) continue;
    const day = Math.max(0, Math.floor((new Date(n.fsrs.due).getTime() - now.getTime()) / DAY_MS));
    if (day < days) counts[day] = (counts[day] ?? 0) + 1;
  }
  return counts;
}

/** Hop distances from `start` along chains in either direction, up to `max`. */
function distances(start: string, index: GraphIndex, max: number): Map<string, number> {
  const out = new Map<string, number>([[start, 0]]);
  let layer = [start];
  for (let d = 1; d <= max && layer.length; d += 1) {
    const next: string[] = [];
    for (const id of layer) {
      const around = [...(index.into.get(id) ?? []).flatMap((c) => c.premises), ...(index.outOf.get(id) ?? []).map((c) => c.conclusion)];
      for (const nb of around) {
        if (out.has(nb)) continue;
        out.set(nb, d);
        next.push(nb);
      }
    }
    layer = next;
  }
  return out;
}

/**
 * Group due ideas into compound problems (design §5.2): seed each group with the most faded idea
 * left, then add the nearest due ideas within GROUP_DISTANCE, so one problem needs several fading
 * ideas that genuinely belong together. Ideas with no due neighbour get a problem of their own.
 */
export function groupForPractice(dueIds: string[], index: GraphIndex, maxProblems = MAX_SET_PROBLEMS, perProblem = MAX_PER_PROBLEM): string[][] {
  const left = [...dueIds];
  const groups: string[][] = [];
  while (left.length && groups.length < maxProblems) {
    const seed = left.shift() as string;
    const dist = distances(seed, index, GROUP_DISTANCE);
    const near = left
      .map((id, order) => ({ id, order, d: dist.get(id) }))
      .filter((x): x is { id: string; order: number; d: number } => x.d !== undefined)
      .sort((a, b) => a.d - b.d || a.order - b.order)
      .slice(0, perProblem - 1)
      .map((x) => x.id);
    for (const id of near) left.splice(left.indexOf(id), 1);
    groups.push([seed, ...near]);
  }
  return groups;
}

export type Presentation = 'theory' | 'application';

export interface ProblemSpec {
  nodeIds: string[];
  /** 0 worked example · 1 completion · 2 direct exercise · 3 composition · 4 path-finding. */
  rung: number;
  /** 0 lesson context · 1 adjacent · 2 far. */
  cue: number;
  presentation: Presentation;
}

/**
 * Specify one problem. A single idea gets a direct exercise; several get a composition; once every
 * idea in a group has been practised twice, the learner must find which ideas apply (path-finding).
 * Cue distance grows with successful practice. Outcome and project goals practise in applications;
 * otherwise far cues are applications and the rest alternate, so the subject's own terms stay.
 */
export function specifyProblem(group: string[], inputs: Map<string, ScheduleInput>, assessment: Assessment, salt = 0): ProblemSpec {
  const practice = group.map((id) => inputs.get(id)?.practiceCount ?? 0);
  const leastPractised = Math.min(...practice);
  const rung = group.length === 1 ? 2 : leastPractised >= 2 ? 4 : 3;
  const cue = Math.min(2, leastPractised);
  let presentation: Presentation;
  if (assessment === 'outcome' || assessment === 'presentation_or_project') presentation = 'application';
  else if (cue === 2) presentation = 'application';
  else presentation = (hashOf(group.join('|')) + salt) % 2 === 0 ? 'theory' : 'application';
  return { nodeIds: group, rung, cue, presentation };
}

/** A mock exam: one problem per target idea that is taught (depth ≥ 2), deepest targets first. */
export function mockExamSpecs(targets: { nodeId: string; targetDepth: Depth; depth: Depth }[], size = 5): ProblemSpec[] {
  return targets
    .filter((t) => t.depth >= 2)
    .sort((a, b) => b.targetDepth - a.targetDepth || a.nodeId.localeCompare(b.nodeId))
    .slice(0, size)
    .map((t) => ({ nodeIds: [t.nodeId], rung: t.targetDepth >= 4 ? 4 : 3, cue: 1, presentation: 'theory' as const }));
}

export function mockExamsOpen(assessment: Assessment, examDate: Date | null, now: Date): boolean {
  if (assessment !== 'written_exam' || !examDate) return false;
  const left = examDate.getTime() - now.getTime();
  return left > 0 && left <= MOCK_WINDOW_DAYS * DAY_MS;
}

export type DayMode = 'build' | 'deepen' | 'consolidate';

export interface ModeInput {
  due: DueNode[];
  /** Depth of each due idea, so protecting deep ideas counts more. */
  depthOf: (nodeId: string) => number;
  /** Leverage of the goal's learnable-now ideas, highest first. */
  fringeLeverage: number[];
  /** Depth still missing on taught ideas the goal needs deeper (one level per idea per session). */
  deepenGaps: number[];
  daysToExam: number | null;
}

export interface ModeChoice {
  mode: DayMode;
  /** Expected depth points per minute for each mode, for the explanation and tests. */
  value: Record<DayMode, number>;
}

const MINUTES_PER_PROBLEM = 5;
const MINUTES_PER_NEW_IDEA = 8;
const MINUTES_PER_DEEPEN = 6;

/**
 * Build, deepen or consolidate by expected depth points per minute (design §6). Consolidating
 * protects depth that would otherwise be lost: Σ (1 − recall) × depth over the due ideas, at about
 * five minutes per compound problem. Building gains about two levels per new idea, scaled by its
 * leverage relative to the best one. Deepening gains one level per idea. Close to an exam,
 * consolidation is worth more because there is no time left to relearn.
 */
export function chooseMode(input: ModeInput): ModeChoice {
  const problems = Math.ceil(input.due.length / 2.5);
  const protect = input.due.reduce((s, d) => s + (1 - d.recall) * input.depthOf(d.nodeId), 0);
  const examBoost = input.daysToExam !== null && input.daysToExam <= 7 ? 1.5 : 1;
  const consolidate = problems ? (protect * examBoost) / (problems * MINUTES_PER_PROBLEM) : 0;
  const top = input.fringeLeverage.slice(0, 4);
  const best = top[0] ?? 0;
  const build = top.length && best > 0 ? top.reduce((s, l) => s + 2 * (l / best), 0) / (top.length * MINUTES_PER_NEW_IDEA) : 0;
  const gaps = input.deepenGaps.filter((g) => g > 0).slice(0, 4);
  const deepen = gaps.length ? gaps.length / (gaps.length * MINUTES_PER_DEEPEN) : 0;
  const value = { build, deepen, consolidate };
  const mode = (Object.entries(value) as [DayMode, number][]).reduce((a, b) => (b[1] > a[1] ? b : a), ['build', -1] as [DayMode, number])[0];
  return { mode, value };
}

/** Minutes for one day's work from the goal's pace (a five-day week); 40 when no pace is set. */
export function dailyMinutes(hoursPerWeek: number | null): number {
  if (!hoursPerWeek || hoursPerWeek <= 0) return 40;
  return Math.max(15, Math.min(120, Math.round((hoursPerWeek * 60) / 5)));
}

export function daysUntil(date: Date | null, now: Date): number | null {
  if (!date) return null;
  return Math.ceil((date.getTime() - now.getTime()) / DAY_MS);
}

function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
