/**
 * The weekly review (design §10, "Your week"): one page per week, Monday to Sunday in the learner's
 * time zone. What was learned (ideas that reached a new depth), what faded (learned ideas below 70%
 * recall at the week's end, not practised that week), where the learner was too sure, and one change to
 * the plan (core/weekReview.ts). Everything is read from the logs; no model call.
 */
import { addDays, localDate, weekStart } from '../core/dates';
import { recallProbability } from '../core/fsrs';
import { deriveState } from '../core/nodeState';
import { reachedWord } from '../core/notes';
import { PASS_SCORE } from '../core/types';
import type { Evidence } from '../core/types';
import { FADED_RECALL, SURE, suggestChange, tooSure } from '../core/weekReview';
import type { Suggestion } from '../core/weekReview';
import { listReviewsSince } from '../store/cards';
import type { Database } from '../store/db';
import { listEvidenceSince } from '../store/evidence';
import { listGoals } from '../store/goals';
import { listSessions } from '../store/sessions';
import { listNodes } from '../store/world';
import { attributeTime, freeStudy, goalProgress } from './budget';
import { depthHistory } from './stats';

/** Weeks back the review can go. */
export const WEEKS_BACK = 26;
/** Ideas listed per part; the rest are counted. */
const LISTED = 10;

export interface WeekReviewView {
  /** Monday and Sunday of the week, as local dates. */
  start: string;
  end: string;
  current: boolean;
  /** Whether an earlier week can be opened. */
  hasEarlier: boolean;
  minutes: number;
  sessions: number;
  answers: number;
  cardsReviewed: number;
  learned: { nodeId: string; name: string; reached: string }[];
  learnedCount: number;
  faded: { nodeId: string; name: string; recall: number }[];
  fadedCount: number;
  tooSure: { nodeId: string; name: string; count: number }[];
  /** Answers given fairly sure or sure, and how many of them passed. */
  sure: { answers: number; right: number };
  suggestion: Suggestion;
}

/** The week that `weekOf` (a local date, default today) falls in. */
export function weekReview(db: Database, weekOf: string | null = null, now = new Date()): WeekReviewView {
  const thisWeek = weekStart(now);
  const asked = weekOf ? weekStart(new Date(`${weekOf}T12:00:00`)) : thisWeek;
  const earliest = addDays(thisWeek, -7 * WEEKS_BACK);
  const start = asked > thisWeek ? thisWeek : asked < earliest ? earliest : asked;
  const end = addDays(start, 7);
  const [from, to] = [start.toISOString(), end.toISOString()];
  const current = start.getTime() === thisWeek.getTime();
  const at = current ? now : end;
  const inWeek = (iso: string) => iso >= from && iso < to;

  const names = new Map(listNodes(db).map((n) => [n.id, n.name]));
  const name = (id: string) => names.get(id) ?? id;
  const all = listEvidenceSince(db, '0000').filter((e) => names.has(e.nodeId));
  const answers = all.filter((e) => inWeek(e.at) && !e.context.implicit && e.kind !== 'lookup');

  // time: each goal's share, and free study
  const goals = listGoals(db).filter((g) => g.status === 'active');
  const shares = attributeTime(db).filter((s) => inWeek(s.span.endedAt));
  const free = freeStudy(db).filter((s) => inWeek(s.span.endedAt));
  const minutes = shares.reduce((sum, s) => sum + s.minutes, 0) + free.reduce((sum, s) => sum + s.minutes, 0);

  // learned: the deepest new depth each idea reached this week
  const reached = new Map<string, number>();
  for (const t of depthHistory(all)) if (inWeek(t.at) && t.to > t.from) reached.set(t.nodeId, Math.max(reached.get(t.nodeId) ?? 0, t.to));
  const learned = [...reached].sort((a, b) => b[1] - a[1] || name(a[0]).localeCompare(name(b[0]))).map(([nodeId, depth]) => ({ nodeId, name: name(nodeId), reached: reachedWord(depth) ?? '' }));

  // faded: learned by the week's end, below the line then, and not practised in the week
  const byNode = new Map<string, Evidence[]>();
  for (const e of all) if (e.at < to) byNode.set(e.nodeId, [...(byNode.get(e.nodeId) ?? []), e]);
  const touched = new Set(answers.map((e) => e.nodeId));
  const faded = [...byNode]
    .filter(([id]) => !touched.has(id))
    .map(([nodeId, list]) => ({ nodeId, state: deriveState(list) }))
    .filter(({ state }) => state.depth >= 1)
    .map(({ nodeId, state }) => ({ nodeId, name: name(nodeId), recall: recallProbability(state.fsrs, at) }))
    .filter((f) => f.recall < FADED_RECALL)
    .sort((a, b) => a.recall - b.recall);

  const wrongs = tooSure(answers).map((t) => ({ ...t, name: name(t.nodeId) }));
  const sure = answers.filter((e) => e.confidence !== null && e.confidence >= SURE);
  const elapsed = current ? Math.min(1, Math.max(0.1, (now.getTime() - start.getTime()) / (end.getTime() - start.getTime()))) : 1;
  const goalWeeks = goals.map((g) => {
    const progress = goalProgress(db, g.id, now);
    return {
      goalId: g.id,
      title: g.title ?? g.text,
      minutes: shares.filter((s) => s.goalId === g.id).reduce((sum, s) => sum + s.minutes, 0),
      weeklyTarget: progress?.weeklyTarget ?? null,
      // time the plan no longer needs is about now: offered on the current week only
      roomMinutes: current ? (progress?.room?.minutes ?? null) : null,
    };
  });

  return {
    start: localDate(start),
    end: localDate(addDays(start, 6)),
    current,
    hasEarlier: start > earliest,
    minutes: Math.round(minutes),
    sessions: listSessions(db, 10_000).filter((s) => inWeek(s.startedAt)).length,
    answers: answers.length,
    cardsReviewed: listReviewsSince(db, from).filter((r) => r.at < to).length,
    learned: learned.slice(0, LISTED),
    learnedCount: learned.length,
    faded: faded.slice(0, LISTED),
    fadedCount: faded.length,
    tooSure: wrongs.slice(0, LISTED),
    sure: { answers: sure.length, right: sure.filter((e) => e.score >= PASS_SCORE).length },
    suggestion: suggestChange({ minutes, elapsed, goals: goalWeeks, faded: faded.length, tooSure: wrongs }),
  };
}
