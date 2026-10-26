/**
 * Thin wrapper over ts-fsrs. Scores 0–1 map to FSRS ratings; partial credit (implicit review)
 * moves stability and difficulty a fraction of the way toward a full review.
 */
import { Rating, State, createEmptyCard, fsrs, generatorParameters } from 'ts-fsrs';
import type { Card, Grade } from 'ts-fsrs';
import type { FsrsState } from './types';

const PARAMS = generatorParameters({ enable_fuzz: false, enable_short_term: false, request_retention: 0.9 });
const scheduler = fsrs(PARAMS);
const DAY_MS = 86_400_000;

export function emptyFsrs(): FsrsState {
  return { stability: 0, difficulty: 0, lastReview: null, due: null, reps: 0, lapses: 0 };
}

export function scoreToRating(score: number): Grade {
  if (score < 0.4) return Rating.Again;
  if (score < 0.6) return Rating.Hard;
  if (score < 0.85) return Rating.Good;
  return Rating.Easy;
}

function toCard(state: FsrsState, now: Date): Card {
  if (!state.lastReview) return createEmptyCard(now);
  return {
    due: new Date(state.due ?? state.lastReview),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: state.reps,
    lapses: state.lapses,
    state: State.Review,
    last_review: new Date(state.lastReview),
  };
}

/**
 * Apply one review. `weight` below 1 gives partial credit: the state moves that fraction of the way
 * from its current values to what a full review would produce (the idea behind fractional implicit repetition).
 */
export function applyReview(state: FsrsState, score: number, at: Date, weight = 1): FsrsState {
  const w = Math.max(0, Math.min(1, weight));
  if (w === 0) return state;
  const card = toCard(state, at);
  const next = scheduler.next(card, at, scoreToRating(score)).card;
  if (w >= 1) {
    return {
      stability: next.stability,
      difficulty: next.difficulty,
      lastReview: at.toISOString(),
      due: next.due.toISOString(),
      reps: next.reps,
      lapses: next.lapses,
    };
  }
  const stability = state.stability + w * (next.stability - state.stability);
  const difficulty = state.lastReview ? state.difficulty + w * (next.difficulty - state.difficulty) : next.difficulty;
  const intervalDays = Math.max(1, scheduler.next_interval(stability, 0));
  return {
    stability,
    difficulty,
    lastReview: at.toISOString(),
    due: new Date(at.getTime() + intervalDays * DAY_MS).toISOString(),
    reps: state.reps + 1,
    lapses: state.lapses + (scoreToRating(score) === Rating.Again && state.lastReview ? 1 : 0),
  };
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
