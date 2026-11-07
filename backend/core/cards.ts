/**
 * Flashcards for hard facts (design §5.2, §2.4): each card's FSRS schedule derived from its
 * append-only reviews, the intervals a rating would give, the review queue with its daily limit of
 * new cards, how many automatic cards a goal still has room for, and when a session may count as a
 * review. Pure: no IO.
 */
import { Rating, State, createEmptyCard, fsrs, generatorParameters } from 'ts-fsrs';
import type { Card, Grade } from 'ts-fsrs';

export const CARD_RATINGS = [1, 2, 3, 4] as const;
/** Again, Hard, Good, Easy (the FSRS grades). */
export type CardRating = (typeof CARD_RATINGS)[number];
export const RATING_LABEL: Record<CardRating, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

/** How a card came to be: written after an idea was learned, from selected text, from a request, or by hand. */
export const CARD_ORIGINS = ['auto', 'selection', 'request', 'hand'] as const;
export type CardOrigin = (typeof CARD_ORIGINS)[number];

/** Where a review came from: the Cards screen, or a session or practice answer that recalled the fact. */
export const REVIEW_SOURCES = ['review', 'session', 'practice'] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

export interface CardReview {
  at: string;
  rating: CardRating;
  source: ReviewSource;
}

export type CardPhase = 'new' | 'learning' | 'review' | 'relearning';

export interface CardSchedule {
  phase: CardPhase;
  /** When the card is next due; null for a card never reviewed. */
  due: string | null;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  lastReview: string | null;
}

/** A card is a question and a short answer (the card writer and the card editor share these limits). */
export const CARD_FRONT_MAX = 600;
export const CARD_BACK_MAX = 2000;

/** New cards that enter the review queue per day. */
export const NEW_PER_DAY = 20;
/** Automatic cards per finished idea. */
export const CARDS_PER_IDEA = 3;
export const DEFAULT_GOAL_CARDS = { enabled: true, max: 40 } as const;
/** When nothing else is due, a card in its learning steps may come this early, so a sitting can finish. */
export const LEARN_AHEAD_MS = 20 * 60_000;
/** A card gets at most one review from sessions and practice within this window. */
export const CREDIT_GAP_MS = 12 * 3_600_000;

/**
 * Unlike ideas (core/fsrs.ts, kept over days by practice), a card uses FSRS's short learning steps: a
 * card missed in review comes back within minutes in the same sitting, which is what makes drilling
 * a formula work. No fuzz, so the same reviews always give the same schedule.
 */
const scheduler = fsrs(generatorParameters({ enable_fuzz: false, enable_short_term: true, request_retention: 0.9 }));

const PHASE: Record<State, CardPhase> = { [State.New]: 'new', [State.Learning]: 'learning', [State.Review]: 'review', [State.Relearning]: 'relearning' };

function byTime(reviews: readonly CardReview[]): CardReview[] {
  return [...reviews].sort((a, b) => a.at.localeCompare(b.at));
}

function replay(reviews: readonly CardReview[], createdAt: string): Card {
  let card = createEmptyCard(new Date(createdAt));
  for (const r of byTime(reviews)) card = scheduler.next(card, new Date(r.at), r.rating as Grade).card;
  return card;
}

/** The card's schedule now: every review replayed in order (the reviews are the record; this is derived). */
export function scheduleOf(reviews: readonly CardReview[], createdAt: string): CardSchedule {
  if (reviews.length === 0) return { phase: 'new', due: null, stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: null };
  const card = replay(reviews, createdAt);
  return {
    phase: PHASE[card.state],
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: card.last_review ? card.last_review.toISOString() : null,
  };
}

/** When the card would come back after each rating given now. */
export function nextDueByRating(reviews: readonly CardReview[], createdAt: string, now: Date): Record<CardRating, string> {
  const outcomes = scheduler.repeat(replay(reviews, createdAt), now);
  const due = (rating: Grade) => outcomes[rating].card.due.toISOString();
  return { 1: due(Rating.Again), 2: due(Rating.Hard), 3: due(Rating.Good), 4: due(Rating.Easy) };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A wait in plain words for the rating buttons and card lists: "1 min", "5 hours", "3 days", "2 months". */
export function formatInterval(ms: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  // each unit is chosen after rounding, so a wait just short of a day reads "1 day", not "24 hours"
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(ms / HOUR);
  if (hours < 24) return plural(hours, 'hour');
  const days = Math.round(ms / DAY);
  if (days < 30) return plural(days, 'day');
  const months = Math.round(ms / (30 * DAY));
  if (months < 12) return plural(months, 'month');
  const years = Math.round((ms / (365 * DAY)) * 10) / 10;
  return `${years} ${years === 1 ? 'year' : 'years'}`;
}

export interface QueueEntry {
  id: string;
  createdAt: string;
  schedule: CardSchedule;
}

export interface ReviewQueue<T> {
  /** The cards to review now, in order. */
  cards: T[];
  /** New cards waiting beyond today's limit. */
  newWaiting: number;
  /** The next time a card falls due, when nothing is due now. */
  nextDue: string | null;
}

/**
 * What to review now: cards in their learning steps that are due, then due reviews (most overdue
 * first), then new cards (oldest first) up to what is left of today's limit. When nothing else is
 * due, a learning card due within the next 20 minutes comes early so the sitting can finish.
 */
export function reviewQueue<T extends QueueEntry>(entries: readonly T[], now: Date, introducedToday: number, newPerDay = NEW_PER_DAY): ReviewQueue<T> {
  const t = now.getTime();
  const dueAt = (e: T) => (e.schedule.due ? new Date(e.schedule.due).getTime() : Number.POSITIVE_INFINITY);
  const learning = (e: T) => e.schedule.phase === 'learning' || e.schedule.phase === 'relearning';
  const byDue = (a: T, b: T) => dueAt(a) - dueAt(b);
  const fresh = entries.filter((e) => e.schedule.phase === 'new').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const allowed = Math.max(0, newPerDay - introducedToday);
  const dueLearning = entries.filter((e) => learning(e) && dueAt(e) <= t).sort(byDue);
  const dueReviews = entries.filter((e) => e.schedule.phase === 'review' && dueAt(e) <= t).sort(byDue);
  const cards = [...dueLearning, ...dueReviews, ...fresh.slice(0, allowed)];
  const newWaiting = Math.max(0, fresh.length - allowed);
  if (cards.length > 0) return { cards, newWaiting, nextDue: null };
  const upcoming = entries.filter((e) => e.schedule.phase !== 'new').sort(byDue);
  const soon = upcoming.find((e) => learning(e) && dueAt(e) - t <= LEARN_AHEAD_MS);
  if (soon) return { cards: [soon], newWaiting, nextDue: null };
  return { cards: [], newWaiting, nextDue: upcoming[0]?.schedule.due ?? null };
}

/**
 * New cards already introduced today: cards whose first review on the Cards screen was at or after
 * the start of the day. A card first recalled in a session was studied there, so it does not use up
 * a place among today's new cards.
 */
export function introducedSince(firstReviewAt: Iterable<string | null>, dayStart: Date): number {
  const start = dayStart.toISOString();
  let n = 0;
  for (const at of firstReviewAt) if (at !== null && at >= start) n += 1;
  return n;
}

/** How many automatic cards to ask for after an idea: at most three, and never past the goal's maximum. */
export function cardsToAsk(max: number | null, existing: number, perIdea = CARDS_PER_IDEA): number {
  const room = max === null ? perIdea : max - existing;
  return Math.max(0, Math.min(perIdea, room));
}

/**
 * A session or practice answer that recalled a card's fact counts as a "Good" review, but at most once
 * per card in `CREDIT_GAP_MS`: one session asking for the same fact on several steps is one retrieval,
 * not several, and must not make the card look better learned than it is.
 */
export function creditable(lastReviewAt: string | null, now: Date): boolean {
  return lastReviewAt === null || now.getTime() - new Date(lastReviewAt).getTime() >= CREDIT_GAP_MS;
}

/** A session finished an idea (it reached its aim or wrapped up): what its automatic cards are written from. */
export interface IdeaFinished {
  sessionId: string;
  /** Null for a session with no goal. */
  goalId: string | null;
  nodeId: string;
  /** What the session taught about the idea: explanations, worked examples, gists. */
  taught: string[];
  /** The learner's answers on the idea's steps: the question (with its key), the answer, the score 0–1. */
  answers: { question: string; answer: string; score: number | null }[];
}

/** The card text compared for duplicates: case, spacing and Markdown emphasis do not make a new card. */
export function cardKey(front: string): string {
  return front
    .toLowerCase()
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
