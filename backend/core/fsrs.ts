/**
 * Thin wrapper over ts-fsrs. Scores 0–1 map to FSRS ratings; partial credit (implicit review)
 * moves stability and difficulty a fraction of the way toward a full review.
 *
 * The memory model is called directly with the real time since the last review, in days and
 * fractions of a day. The library's card scheduler counts whole UTC calendar days instead, so two
 * answers twenty minutes apart counted as a day when midnight UTC (01:00 in Germany) fell between
 * them, and as nothing otherwise.
 */
import { Rating, fsrs, generatorParameters } from 'ts-fsrs';
import type { Grade } from 'ts-fsrs';
import type { FsrsState } from './types';
import { PASS_SCORE } from './types';

const PARAMS = generatorParameters({ enable_fuzz: false, enable_short_term: false, request_retention: 0.9 });
const scheduler = fsrs(PARAMS);
const DAY_MS = 86_400_000;
/** The smallest stability the memory model accepts. */
const MIN_STABILITY = 0.001;

export function emptyFsrs(): FsrsState {
  return { stability: 0, difficulty: 0, lastReview: null, due: null, reps: 0, lapses: 0 };
}

/**
 * A score below the pass mark is a failed recall (Again), whatever its size: a failed answer must
 * never lengthen the time until the idea comes back. A pass is Hard when it only just passed, Good,
 * or Easy from the score the tutor calls strong.
 */
export function scoreToRating(score: number): Grade {
  if (score < PASS_SCORE) return Rating.Again;
  if (score < 0.75) return Rating.Hard;
  if (score < 0.85) return Rating.Good;
  return Rating.Easy;
}

/**
 * Apply one review. `weight` below 1 gives partial credit: stability, difficulty and the review clock
 * move that fraction of the way from their current values to what a full review would produce (the
 * idea behind fractional implicit repetition).
 */
export function applyReview(state: FsrsState, score: number, at: Date, weight = 1): FsrsState {
  const w = Math.max(0, Math.min(1, weight));
  if (w === 0) return state;
  const rating = scoreToRating(score);
  const last = state.lastReview ? new Date(state.lastReview).getTime() : null;
  // a clock set back must not break the fold: time never runs backwards between two reviews
  const elapsedDays = last === null ? 0 : Math.max(0, (at.getTime() - last) / DAY_MS);
  const memory = last === null ? null : { stability: Math.max(MIN_STABILITY, state.stability), difficulty: Math.max(1, state.difficulty) };
  const next = scheduler.next_state(memory, elapsedDays, rating);
  const reps = state.reps + 1;
  const lapses = state.lapses + (rating === Rating.Again && last !== null ? 1 : 0);
  if (w >= 1) {
    return { stability: next.stability, difficulty: next.difficulty, lastReview: at.toISOString(), due: dueAfter(at.getTime(), next.stability), reps, lapses };
  }
  const stability = state.stability + w * (next.stability - state.stability);
  const difficulty = last === null ? next.difficulty : state.difficulty + w * (next.difficulty - state.difficulty);
  // The clock moves the same fraction of the way: a light touch (implicit credit two hops away) must
  // not make a long-unreviewed idea look freshly reviewed.
  const lastReview = last === null ? at.getTime() : last + w * (at.getTime() - last);
  return { stability, difficulty, lastReview: new Date(lastReview).toISOString(), due: dueAfter(lastReview, stability), reps, lapses };
}

function dueAfter(reviewedAt: number, stability: number): string {
  const intervalDays = Math.max(1, scheduler.next_interval(Math.max(MIN_STABILITY, stability), 0));
  return new Date(reviewedAt + intervalDays * DAY_MS).toISOString();
}

/** Probability of recall right now: 0 with no review history, else the FSRS forgetting curve. */
export function recallProbability(state: FsrsState, now: Date): number {
  if (!state.lastReview || state.stability <= 0) return 0;
  const elapsedDays = Math.max(0, (now.getTime() - new Date(state.lastReview).getTime()) / DAY_MS);
  return scheduler.forgetting_curve(elapsedDays, state.stability);
}

export function isDue(state: FsrsState, now: Date): boolean {
  return state.due !== null && new Date(state.due).getTime() <= now.getTime();
}
