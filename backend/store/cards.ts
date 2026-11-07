/** Flashcards: the cards, the ideas each is tagged with, their append-only reviews, and per-goal settings. */
import { DEFAULT_GOAL_CARDS } from '../core/cards';
import type { CardOrigin, CardRating, CardReview, ReviewSource } from '../core/cards';
import type { Database } from './db';
import { nowIso } from './db';
import { newId } from './ids';
import { getSetting, setSetting } from './settingsTable';

export interface CardRecord {
  id: string;
  front: string;
  back: string;
  goalId: string | null;
  origin: CardOrigin;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
  suspendedAt: string | null;
  /** The ideas it is tagged with; never empty for a stored card. */
  nodeIds: string[];
}

export interface NewCard {
  front: string;
  back: string;
  nodeIds: string[];
  goalId: string | null;
  origin: CardOrigin;
  sessionId?: string | null;
}

interface CardRow {
  id: string;
  front: string;
  back: string;
  goal_id: string | null;
  origin: CardOrigin;
  session_id: string | null;
  created_at: string;
  updated_at: string;
  suspended_at: string | null;
}

/** Tags in the order they were given (the first is the card's main idea), for one card or all. */
function tagsOf(db: Database, cardId?: string): Map<string, string[]> {
  const rows = (
    cardId ? db.prepare('SELECT card_id, node_id FROM card_ideas WHERE card_id = ? ORDER BY rowid').all(cardId) : db.prepare('SELECT card_id, node_id FROM card_ideas ORDER BY rowid').all()
  ) as { card_id: string; node_id: string }[];
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.card_id, [...(out.get(r.card_id) ?? []), r.node_id]);
  return out;
}

const toCard = (r: CardRow, tags: Map<string, string[]>): CardRecord => ({
  id: r.id,
  front: r.front,
  back: r.back,
  goalId: r.goal_id,
  origin: r.origin,
  sessionId: r.session_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  suspendedAt: r.suspended_at,
  nodeIds: tags.get(r.id) ?? [],
});

function setTags(db: Database, cardId: string, nodeIds: string[]): void {
  db.prepare('DELETE FROM card_ideas WHERE card_id = ?').run(cardId);
  const insert = db.prepare('INSERT OR IGNORE INTO card_ideas (card_id, node_id) VALUES (?, ?)');
  for (const nodeId of nodeIds) insert.run(cardId, nodeId);
}

export function createCard(db: Database, card: NewCard, at = nowIso()): CardRecord {
  const id = newId('card');
  db.prepare('INSERT INTO cards (id, front, back, goal_id, origin, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id,
    card.front,
    card.back,
    card.goalId,
    card.origin,
    card.sessionId ?? null,
    at,
    at,
  );
  setTags(db, id, card.nodeIds);
  return getCard(db, id) as CardRecord;
}

/** Edit the text and tags; the schedule stays, since it lives in the reviews. */
export function updateCard(db: Database, id: string, patch: { front: string; back: string; nodeIds: string[] }): void {
  db.prepare('UPDATE cards SET front = ?, back = ?, updated_at = ? WHERE id = ?').run(patch.front, patch.back, nowIso(), id);
  setTags(db, id, patch.nodeIds);
}

export function setSuspended(db: Database, id: string, suspended: boolean): void {
  db.prepare('UPDATE cards SET suspended_at = ? WHERE id = ?').run(suspended ? nowIso() : null, id);
}

export function deleteCard(db: Database, id: string): void {
  db.prepare('DELETE FROM cards WHERE id = ?').run(id);
}

export function getCard(db: Database, id: string): CardRecord | undefined {
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as CardRow | undefined;
  return row ? toCard(row, tagsOf(db, id)) : undefined;
}

export function listCards(db: Database): CardRecord[] {
  const tags = tagsOf(db);
  return (db.prepare('SELECT * FROM cards ORDER BY created_at, rowid').all() as unknown as CardRow[]).map((r) => toCard(r, tags));
}

/** Cards tagged with any of these ideas. */
export function cardsForNodes(db: Database, nodeIds: string[]): CardRecord[] {
  if (nodeIds.length === 0) return [];
  const ids = db.prepare(`SELECT DISTINCT card_id FROM card_ideas WHERE node_id IN (${nodeIds.map(() => '?').join(', ')})`).all(...nodeIds) as { card_id: string }[];
  const wanted = new Set(ids.map((r) => r.card_id));
  return listCards(db).filter((c) => wanted.has(c.id));
}

/** Automatic cards made for a goal, which its maximum counts. */
export function countAutoCards(db: Database, goalId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM cards WHERE goal_id = ? AND origin = 'auto'").get(goalId) as { n: number }).n;
}

/** Cards per idea, for the map. */
export function cardCountsByNode(db: Database): Map<string, number> {
  const rows = db.prepare('SELECT node_id, COUNT(*) AS n FROM card_ideas GROUP BY node_id').all() as { node_id: string; n: number }[];
  return new Map(rows.map((r) => [r.node_id, r.n]));
}

export function nodesWithCards(db: Database): Set<string> {
  return new Set(cardCountsByNode(db).keys());
}

/** Cards that would have no idea left once these ideas are gone. */
export function cardsOnlyOn(db: Database, nodeIds: Set<string>): string[] {
  return [...tagsOf(db)].filter(([, tags]) => tags.every((t) => nodeIds.has(t))).map(([cardId]) => cardId);
}

/** A card whose every idea was removed has nothing to hang on: it goes too. */
export function deleteUntaggedCards(db: Database): number {
  return Number(db.prepare('DELETE FROM cards WHERE id NOT IN (SELECT card_id FROM card_ideas)').run().changes);
}

export function insertReview(db: Database, cardId: string, review: { rating: CardRating; source: ReviewSource; sessionId?: string | null }, at = nowIso()): void {
  db.prepare('INSERT INTO card_reviews (id, card_id, at, rating, source, session_id) VALUES (?, ?, ?, ?, ?, ?)').run(newId('rev'), cardId, at, review.rating, review.source, review.sessionId ?? null);
}

/** Every card's reviews, oldest first. */
export function reviewsByCard(db: Database): Map<string, CardReview[]> {
  const rows = db.prepare('SELECT card_id, at, rating, source FROM card_reviews ORDER BY at, rowid').all() as { card_id: string; at: string; rating: CardRating; source: ReviewSource }[];
  const out = new Map<string, CardReview[]>();
  for (const r of rows) out.set(r.card_id, [...(out.get(r.card_id) ?? []), { at: r.at, rating: r.rating, source: r.source }]);
  return out;
}

export interface ReviewRow extends CardReview {
  cardId: string;
  sessionId: string | null;
}

export function listReviewsSince(db: Database, since: string | null): ReviewRow[] {
  const rows = db.prepare('SELECT card_id, at, rating, source, session_id FROM card_reviews WHERE at >= ? ORDER BY at, rowid').all(since ?? '') as {
    card_id: string;
    at: string;
    rating: CardRating;
    source: ReviewSource;
    session_id: string | null;
  }[];
  return rows.map((r) => ({ cardId: r.card_id, at: r.at, rating: r.rating, source: r.source, sessionId: r.session_id }));
}

export interface GoalCardSettings {
  /** Make flashcards for me. */
  enabled: boolean;
  /** At most this many automatic cards. */
  max: number;
}

export function getGoalCardSettings(db: Database, goalId: string): GoalCardSettings {
  const row = db.prepare('SELECT enabled, max_cards FROM goal_card_settings WHERE goal_id = ?').get(goalId) as { enabled: number; max_cards: number } | undefined;
  return row ? { enabled: row.enabled === 1, max: row.max_cards } : { ...DEFAULT_GOAL_CARDS };
}

export function saveGoalCardSettings(db: Database, goalId: string, settings: GoalCardSettings): void {
  db.prepare('INSERT INTO goal_card_settings (goal_id, enabled, max_cards) VALUES (?, ?, ?) ON CONFLICT(goal_id) DO UPDATE SET enabled = excluded.enabled, max_cards = excluded.max_cards').run(
    goalId,
    settings.enabled ? 1 : 0,
    settings.max,
  );
}

const WITHOUT_GOAL_KEY = 'cards.withoutGoal';

/** Whether sessions with no goal make cards (Settings); on unless turned off. */
export function cardsWithoutGoal(db: Database): boolean {
  return getSetting(db, WITHOUT_GOAL_KEY) !== 'off';
}

export function setCardsWithoutGoal(db: Database, on: boolean): void {
  setSetting(db, WITHOUT_GOAL_KEY, on ? 'on' : 'off');
}
