/**
 * Flashcards for hard facts (design §5.2): the one writer of cards and their reviews. Saving, editing,
 * suspending and deleting cards; the review queue and each review; a "Good" review when a session or
 * practice answer recalled a card's fact; automatic cards after a session finishes an idea, in the
 * background and within the goal's maximum; drafts from a selection or a request; and what Today, the
 * goal page, the map and Stats show of them.
 */
import { z } from 'zod';
import { CardTextSchema, draftCard, writeIdeaCards } from '../agents/cardWriter';
import type { CardGoal, CardText } from '../agents/cardWriter';
import { CARD_ORIGINS, aroundSelection, cardKey, cardsToAsk, creditable, introducedSince, nextDueByRating, reviewQueue, scheduleOf } from '../core/cards';
import type { CardOrigin, CardPhase, CardRating, CardReview, CardSchedule, IdeaFinished, ReviewSource } from '../core/cards';
import type { Goal } from '../core/types';
import type { LlmProvider } from '../llm/provider';
import { listActivity } from '../store/activity';
import { cardsForNodes, cardsWithoutGoal, countAutoCards, createCard, deleteCard, getCard, getGoalCardSettings, insertReview, listCards, listReviewsSince, reviewsByCard, reviewsOfCard, saveGoalCardSettings, setCardsWithoutGoal, setSuspended, updateCard, removeLatestScreenReview } from '../store/cards';
import type { CardRecord, GoalCardSettings } from '../store/cards';
import type { Database } from '../store/db';
import { transaction } from '../store/db';
import { getGoal, listCapabilities, listGoals, listTargets } from '../store/goals';
import { getNode, getNodes, searchNodesByName } from '../store/world';
import type { IdeaRef } from './library';
import { RANGE_DAYS } from './stats';
import type { StatsFilter } from './stats';

export type { GoalCardSettings };

export interface CardView {
  id: string;
  front: string;
  back: string;
  /** The ideas it is tagged with, the main one first. */
  ideas: IdeaRef[];
  goalId: string | null;
  goalTitle: string | null;
  origin: CardOrigin;
  createdAt: string;
  suspended: boolean;
  phase: CardPhase;
  /** When it is next due; null for a new card. */
  due: string | null;
  reps: number;
  lapses: number;
}

export interface ReviewCardView extends CardView {
  /** When the card comes back after each rating given now. */
  next: Record<CardRating, string>;
}

export interface CardQueueView {
  goalId: string | null;
  /** The card to review now; null when the queue is empty. */
  card: ReviewCardView | null;
  /** The queue as it stands, the current card included. */
  left: { due: number; new: number };
  /** Cards reviewed on the Cards screen today (all goals). */
  reviewedToday: number;
  /** New cards beyond today's limit, for tomorrow. */
  newWaiting: number;
  /** When the next card falls due, once nothing is due now. */
  nextDue: string | null;
  /** Cards in this view at all (suspended ones included), for the first-use state. */
  total: number;
}

export interface CardSummary {
  total: number;
  /** What Review would show now: due cards and today's new ones. */
  toReview: number;
}

const dayStart = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate());

interface Scheduled {
  record: CardRecord;
  reviews: CardReview[];
  id: string;
  createdAt: string;
  schedule: ReturnType<typeof scheduleOf>;
}

/**
 * Each card's schedule is its reviews replayed; replays are kept per card and done again only when its
 * reviews change (a review is added, or the last one taken back), so a long history is not replayed
 * on every read.
 */
const replays = new WeakMap<Database, Map<string, { key: string; schedule: CardSchedule }>>();

function scheduleFor(db: Database, record: CardRecord, reviews: CardReview[]): CardSchedule {
  let kept = replays.get(db);
  if (!kept) {
    kept = new Map();
    replays.set(db, kept);
  }
  const last = reviews[reviews.length - 1];
  const key = `${record.createdAt}|${reviews.length}|${last?.at ?? ''}|${last?.rating ?? ''}|${last?.source ?? ''}`;
  const hit = kept.get(record.id);
  if (hit?.key === key) return hit.schedule;
  const schedule = scheduleOf(reviews, record.createdAt);
  kept.set(record.id, { key, schedule });
  return schedule;
}

function scheduledOne(db: Database, record: CardRecord): Scheduled {
  const reviews = reviewsOfCard(db, record.id);
  return { record, reviews, id: record.id, createdAt: record.createdAt, schedule: scheduleFor(db, record, reviews) };
}

function scheduled(db: Database, filter: (c: CardRecord) => boolean = () => true): Scheduled[] {
  const reviews = reviewsByCard(db);
  return listCards(db)
    .filter(filter)
    .map((record) => {
      const own = reviews.get(record.id) ?? [];
      return { record, reviews: own, id: record.id, createdAt: record.createdAt, schedule: scheduleFor(db, record, own) };
    });
}

function toView(s: Pick<Scheduled, 'record' | 'schedule'>, names: Map<string, string>, goals: Map<string, Goal>): CardView {
  const { record, schedule } = s;
  const goal = record.goalId ? goals.get(record.goalId) : undefined;
  return {
    id: record.id,
    front: record.front,
    back: record.back,
    ideas: record.nodeIds.map((id) => ({ id, name: names.get(id) ?? id })),
    goalId: record.goalId,
    goalTitle: goal ? (goal.title ?? goal.text) : null,
    origin: record.origin,
    createdAt: record.createdAt,
    suspended: record.suspendedAt !== null,
    phase: schedule.phase,
    due: schedule.due,
    reps: schedule.reps,
    lapses: schedule.lapses,
  };
}

function lookups(db: Database, cards: CardRecord[]) {
  const nodes = getNodes(
    db,
    cards.flatMap((c) => c.nodeIds),
  );
  return { names: new Map([...nodes].map(([id, n]) => [id, n.name])), goals: new Map(listGoals(db).map((g) => [g.id, g])) };
}

/**
 * When each card was introduced on the Cards screen: its very first review, if that was a screen
 * review. A card a session credited first was no longer new, so it never uses up the day's new cards.
 */
function firstReviewsOnScreen(all: Scheduled[]): (string | null)[] {
  return all.map((s) => (s.reviews[0]?.source === 'review' ? s.reviews[0].at : null));
}

/**
 * The review queue for all goals or one: the card to show now and what is left. With `firstId` that
 * card is shown now if it is in the queue (a rating that was just taken back).
 */
export function cardQueue(db: Database, goalId: string | null, now = new Date(), firstId?: string): CardQueueView {
  const all = scheduled(db);
  const inView = all.filter((s) => goalId === null || s.record.goalId === goalId);
  const active = inView.filter((s) => s.record.suspendedAt === null);
  const queue = reviewQueue(active, now, introducedSince(firstReviewsOnScreen(all), dayStart(now)));
  const first = queue.cards.find((c) => c.id === firstId) ?? queue.cards[0];
  const { names, goals } = lookups(db, first ? [first.record] : []);
  const start = dayStart(now).toISOString();
  return {
    goalId,
    card: first ? { ...toView(first, names, goals), next: nextDueByRating(first.reviews, first.createdAt, now) } : null,
    left: { due: queue.cards.filter((c) => c.schedule.phase !== 'new').length, new: queue.cards.filter((c) => c.schedule.phase === 'new').length },
    reviewedToday: all.filter((s) => s.reviews.some((r) => r.source === 'review' && r.at >= start)).length,
    newWaiting: queue.newWaiting,
    nextDue: queue.nextDue,
    total: inView.length,
  };
}

/** How many cards a goal (or every goal) has, and how many Review would show now. */
export function cardSummary(db: Database, goalId: string | null, now = new Date()): CardSummary {
  const all = scheduled(db);
  const inView = all.filter((s) => goalId === null || s.record.goalId === goalId);
  const queue = reviewQueue(
    inView.filter((s) => s.record.suspendedAt === null),
    now,
    introducedSince(firstReviewsOnScreen(all), dayStart(now)),
  );
  return { total: inView.length, toReview: queue.cards.length };
}

/** One review on the Cards screen. Suspended cards cannot be reviewed. */
export function reviewCard(db: Database, cardId: string, rating: CardRating, now = new Date()): void {
  const card = getCard(db, cardId);
  if (!card) throw new Error('That card no longer exists.');
  if (card.suspendedAt) throw new Error('That card is suspended.');
  insertReview(db, cardId, { rating, source: 'review' }, now.toISOString());
}

/** How long a rating on the Cards screen can be taken back. */
export const UNDO_REVIEW_MS = 10 * 60_000;

/** Take back the rating just given to a card (a mis-pressed key): the card is as it was before it. */
export function undoReview(db: Database, cardId: string, now = new Date()): void {
  if (!removeLatestScreenReview(db, cardId, new Date(now.getTime() - UNDO_REVIEW_MS).toISOString())) throw new Error('That rating can no longer be taken back.');
}

/**
 * A session or practice answer recalled these cards' facts, correctly and unaided: each gets a "Good"
 * review, unless it is suspended or already had a review in the last hours (see `creditable`). Wrong
 * answers never come here: a miss in a session never counts against a card. Returns the cards credited.
 */
export function creditRecalledCards(db: Database, cardIds: readonly string[], context: { source: Exclude<ReviewSource, 'review'>; sessionId: string | null }, now = new Date()): string[] {
  const reviews = reviewsByCard(db);
  const credited: string[] = [];
  for (const id of new Set(cardIds)) {
    const card = getCard(db, id);
    if (!card || card.suspendedAt) continue;
    const last = (reviews.get(id) ?? []).at(-1)?.at ?? null;
    if (!creditable(last, now)) continue;
    insertReview(db, id, { rating: 3, source: context.source, sessionId: context.sessionId }, now.toISOString());
    credited.push(id);
  }
  return credited;
}

/** The cards a judgement may find recalled: those on these ideas (the first idea's first), at most `limit`. */
export function cardsToJudge(db: Database, nodeIds: string[], limit = 12): { id: string; front: string; back: string }[] {
  const main = nodeIds[0];
  return cardsForNodes(db, nodeIds)
    .filter((c) => c.suspendedAt === null)
    .sort((a, b) => Number(b.nodeIds.includes(main ?? '')) - Number(a.nodeIds.includes(main ?? '')))
    .slice(0, limit)
    .map((c) => ({ id: c.id, front: c.front, back: c.back }));
}

export const CardInputSchema = CardTextSchema.extend({
  /** Absent for a new card. */
  id: z.string().min(1).optional(),
  nodeIds: z.array(z.string().min(1)).min(1, 'Tag the card with at least one idea.').max(8),
  /** For a new card: the goal it is made in. Absent: the one active goal that holds its first idea, if any. */
  goalId: z.string().min(1).nullable().optional(),
  origin: z.enum(CARD_ORIGINS).exclude(['auto']).optional(),
  sessionId: z.string().min(1).nullable().optional(),
});
export type CardInput = z.infer<typeof CardInputSchema>;

/** The one active goal whose plan holds this idea, when there is exactly one. */
function onlyGoalOf(db: Database, nodeId: string): string | null {
  const active = new Set(
    listGoals(db)
      .filter((g) => g.status === 'active')
      .map((g) => g.id),
  );
  const capGoal = new Map(listCapabilities(db).map((c) => [c.id, c.goalId]));
  const goals = new Set(
    listTargets(db)
      .filter((t) => t.nodeId === nodeId)
      .map((t) => capGoal.get(t.capabilityId))
      .filter((g): g is string => g !== undefined && active.has(g)),
  );
  return goals.size === 1 ? ([...goals][0] ?? null) : null;
}

/** Create or edit a card the learner wrote or adjusted. Ideas that no longer exist are dropped. */
export function saveCard(db: Database, input: CardInput): CardView {
  const parsed = CardInputSchema.parse(input);
  const nodeIds = [...new Set(parsed.nodeIds)].filter((id) => getNode(db, id) !== undefined);
  if (nodeIds.length === 0) throw new Error('The ideas this card was tagged with are no longer on your map.');
  const id = transaction(db, () => {
    if (parsed.id) {
      if (!getCard(db, parsed.id)) throw new Error('That card no longer exists.');
      updateCard(db, parsed.id, { front: parsed.front, back: parsed.back, nodeIds });
      return parsed.id;
    }
    const goalId = parsed.goalId !== undefined ? (parsed.goalId && getGoal(db, parsed.goalId) ? parsed.goalId : null) : onlyGoalOf(db, nodeIds[0] as string);
    return createCard(db, { front: parsed.front, back: parsed.back, nodeIds, goalId, origin: parsed.origin ?? 'hand', sessionId: parsed.sessionId ?? null }).id;
  });
  return cardView(db, id);
}

export function cardView(db: Database, cardId: string): CardView {
  const record = getCard(db, cardId);
  if (!record) throw new Error('That card no longer exists.');
  const s = scheduledOne(db, record);
  const { names, goals } = lookups(db, [s.record]);
  return toView(s, names, goals);
}

export function removeCard(db: Database, cardId: string): void {
  deleteCard(db, cardId);
}

export function suspendCard(db: Database, cardId: string, suspended: boolean): CardView {
  if (!getCard(db, cardId)) throw new Error('That card no longer exists.');
  setSuspended(db, cardId, suspended);
  return cardView(db, cardId);
}

export interface CardListFilter {
  /** One goal's cards; absent for every card. */
  goalId?: string | null;
  /** Cards tagged with this idea. */
  nodeId?: string | null;
  /** Words in the front, back or idea names. */
  query?: string;
}

export interface CardListView {
  cards: CardView[];
  /** Goals that have cards, for the filter. */
  goals: { id: string; title: string }[];
  /** Ideas that have cards, for the filter, by name. */
  ideas: (IdeaRef & { count: number })[];
}

/** Every card for the All cards view, newest first, filtered by goal, idea and words. */
export function listCardViews(db: Database, filter: CardListFilter = {}): CardListView {
  const all = scheduled(db);
  const { names, goals } = lookups(
    db,
    all.map((s) => s.record),
  );
  const words = (filter.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const views = all
    .map((s) => toView(s, names, goals))
    .filter((c) => !filter.goalId || c.goalId === filter.goalId)
    .filter((c) => !filter.nodeId || c.ideas.some((i) => i.id === filter.nodeId))
    .filter((c) => {
      if (!words.length) return true;
      const text = `${c.front} ${c.back} ${c.ideas.map((i) => i.name).join(' ')}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ideaCounts = new Map<string, number>();
  for (const s of all) for (const id of s.record.nodeIds) ideaCounts.set(id, (ideaCounts.get(id) ?? 0) + 1);
  const goalIds = new Set(all.map((s) => s.record.goalId).filter((g): g is string => g !== null));
  return {
    cards: views,
    goals: [...goalIds].flatMap((id) => {
      const g = goals.get(id);
      return g ? [{ id, title: g.title ?? g.text }] : [];
    }),
    ideas: [...ideaCounts]
      .map(([id, count]) => ({ id, name: names.get(id) ?? id, count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Ideas to tag a card with, by name first, then by what they say. */
export function findIdeas(db: Database, query: string, limit = 8): IdeaRef[] {
  const q = query.trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  return searchNodesByName(db, q, 40)
    .map((n) => ({ id: n.id, name: n.name, rank: n.name.toLowerCase().startsWith(lower) ? 0 : n.name.toLowerCase().includes(lower) ? 1 : 2 }))
    .sort((a, b) => a.rank - b.rank || a.name.length - b.name.length)
    .slice(0, limit)
    .map(({ id, name }) => ({ id, name }));
}

const SELECTION_MAX = 4000;
const MESSAGE_MAX = 16000;

export const DraftRequestSchema = z.object({
  ideaIds: z.array(z.string().min(1)).max(8),
  goalId: z.string().min(1).nullable().optional(),
  // a selection across several messages can be long: it is cut, never refused with a raw error
  selection: z
    .object({ text: z.string().trim().min(1), message: z.string() })
    .transform(({ text, message }) => {
      const kept = text.slice(0, SELECTION_MAX);
      return { text: kept, message: aroundSelection(message, kept, MESSAGE_MAX) };
    })
    .optional(),
  request: z.string().max(1000).optional(),
  partial: z.object({ front: z.string().max(2000), back: z.string().max(4000) }).optional(),
});
export type DraftRequest = z.infer<typeof DraftRequestSchema>;

function cardGoal(goal: Goal | undefined): CardGoal | null {
  return goal ? { text: goal.text, level: goal.level } : null;
}

/** A draft for the card sheet: from a selection (question or answer, the writer decides) or a request. */
export async function draftFor(deps: { db: Database; provider: LlmProvider }, request: DraftRequest): Promise<CardText> {
  const { db } = deps;
  const req = DraftRequestSchema.parse(request);
  const nodes = getNodes(db, req.ideaIds);
  const ideas = req.ideaIds.flatMap((id) => {
    const n = nodes.get(id);
    return n ? [{ name: n.name, statement: n.statement }] : [];
  });
  return draftCard(deps.provider, {
    goal: cardGoal(req.goalId ? getGoal(db, req.goalId) : undefined),
    ideas,
    selection: req.selection,
    request: req.request,
    partial: req.partial,
    existing: cardsForNodes(db, req.ideaIds).map((c) => ({ front: c.front, back: c.back })),
  });
}

export interface CardWriterDeps {
  db: Database;
  provider: LlmProvider;
  /** Told when automatic cards land, so screens can refresh. */
  onChange?: (event: { goalId: string | null }) => void;
  onError?: (message: string) => void;
}

/**
 * Automatic cards for an idea a session just finished: only when the goal makes cards (or, without a
 * goal, when Settings allow it), asking for at most what the goal's maximum leaves, and counting again
 * when the cards arrive, since another idea's cards may have landed meanwhile. Duplicates of the
 * idea's existing cards are dropped.
 */
export async function writeCardsForIdea(deps: CardWriterDeps, event: IdeaFinished): Promise<CardView[]> {
  const { db } = deps;
  const goal = event.goalId ? getGoal(db, event.goalId) : undefined;
  if (event.goalId && !goal) return [];
  // read again when the cards land: the learner may have lowered the maximum or turned cards off meanwhile
  const room = () => {
    const settings = goal ? getGoalCardSettings(db, goal.id) : null;
    if (settings ? !settings.enabled : !cardsWithoutGoal(db)) return 0;
    return cardsToAsk(settings?.max ?? null, goal ? countAutoCards(db, goal.id) : 0);
  };
  const node = getNode(db, event.nodeId);
  const ask = room();
  if (!node || ask === 0) return [];
  const written = await writeIdeaCards(deps.provider, {
    goal: cardGoal(goal),
    idea: { name: node.name, kind: node.kind, statement: node.statement },
    taught: event.taught,
    answers: event.answers,
    existing: cardsForNodes(db, [node.id]).map((c) => ({ front: c.front, back: c.back })),
    max: ask,
  });
  const ids = transaction(db, () => {
    if (!getNode(db, node.id)) return []; // erased while the cards were being written
    const known = new Set(cardsForNodes(db, [node.id]).map((c) => cardKey(c.front)));
    const left = room();
    const kept: string[] = [];
    for (const card of written) {
      if (kept.length >= left) break;
      const key = cardKey(card.front);
      if (known.has(key)) continue;
      known.add(key);
      kept.push(createCard(db, { front: card.front, back: card.back, nodeIds: [node.id], goalId: goal?.id ?? null, origin: 'auto', sessionId: event.sessionId }).id);
    }
    return kept;
  });
  if (ids.length) deps.onChange?.({ goalId: goal?.id ?? null });
  return ids.map((id) => cardView(db, id));
}

const pending = new Set<Promise<void>>();

/** Write an idea's cards in the background; the session never waits for them. */
export function queueIdeaCards(deps: CardWriterDeps, event: IdeaFinished): void {
  const job = writeCardsForIdea(deps, event)
    .then(() => undefined)
    .catch((error: unknown) => deps.onError?.(`Flashcards for an idea could not be written. ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => pending.delete(job));
  pending.add(job);
}

/** Resolves when every card job started so far has finished (for tests). */
export async function settleCardWriting(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}

export const GoalCardSettingsSchema = z.object({ enabled: z.boolean(), max: z.number().int().min(1).max(500) });

export function goalCardSettings(db: Database, goalId: string): GoalCardSettings & { auto: number } {
  return { ...getGoalCardSettings(db, goalId), auto: countAutoCards(db, goalId) };
}

export function saveGoalCards(db: Database, goalId: string, settings: GoalCardSettings): GoalCardSettings & { auto: number } {
  if (!getGoal(db, goalId)) throw new Error('unknown goal');
  saveGoalCardSettings(db, goalId, GoalCardSettingsSchema.parse(settings));
  return goalCardSettings(db, goalId);
}

export interface CardPreferences {
  /** Sessions with no goal make cards too. */
  withoutGoal: boolean;
}

export function cardPreferences(db: Database): CardPreferences {
  return { withoutGoal: cardsWithoutGoal(db) };
}

export function saveCardPreferences(db: Database, prefs: CardPreferences): CardPreferences {
  setCardsWithoutGoal(db, prefs.withoutGoal);
  return cardPreferences(db);
}

export interface CardStats {
  total: number;
  toReview: number;
  /** Reviews on the Cards screen in the range. */
  reviews: number;
  /** Cards a session or practice answer recalled, counted as reviews. */
  recalledInUse: number;
  /** Share of reviews not answered Again; null with no reviews. */
  remembered: number | null;
  /** Active minutes on the Cards screen. */
  minutes: number;
  /** Cards made in the range, by how. */
  made: Record<CardOrigin, number>;
}

/** Flashcards for Stats, by time range and goal. */
export function cardStats(db: Database, filter: Pick<StatsFilter, 'goalId' | 'range'>, now = new Date()): CardStats {
  const days = RANGE_DAYS[filter.range];
  const since = days === null ? null : new Date(now.getTime() - days * 86_400_000).toISOString();
  const cards = listCards(db).filter((c) => !filter.goalId || c.goalId === filter.goalId);
  const ids = new Set(cards.map((c) => c.id));
  const reviews = listReviewsSince(db, since).filter((r) => ids.has(r.cardId));
  const onScreen = reviews.filter((r) => r.source === 'review');
  const seconds = listActivity(db, { kinds: ['time'], since: since ?? undefined })
    .filter((a) => a.data['surface'] === 'cards' && (!filter.goalId || a.goalId === filter.goalId))
    .reduce((s, a) => s + a.seconds, 0);
  const made = Object.fromEntries(CARD_ORIGINS.map((o) => [o, 0])) as Record<CardOrigin, number>;
  for (const c of cards) if (!since || c.createdAt >= since) made[c.origin] += 1;
  return {
    total: cards.length,
    toReview: cardSummary(db, filter.goalId, now).toReview,
    reviews: onScreen.length,
    recalledInUse: reviews.length - onScreen.length,
    remembered: onScreen.length ? onScreen.filter((r) => r.rating !== 1).length / onScreen.length : null,
    minutes: seconds / 60,
    made,
  };
}

export const ReviewInputSchema = z.object({ cardId: z.string().min(1), rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) });
