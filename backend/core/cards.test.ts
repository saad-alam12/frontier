import { describe, expect, it } from 'vitest';
import { CREDIT_GAP_MS, LEARN_AHEAD_MS, NEW_PER_DAY, cardKey, cardsToAsk, creditable, formatInterval, introducedSince, nextDueByRating, reviewQueue, scheduleOf } from './cards';
import type { CardRating, CardReview, CardSchedule, QueueEntry } from './cards';

const t0 = new Date('2026-03-02T09:00:00Z');
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
const review = (minutes: number, rating: CardRating): CardReview => ({ at: at(minutes).toISOString(), rating, source: 'review' });
const created = t0.toISOString();
const minutesUntil = (iso: string | null, from: Date) => (iso ? (new Date(iso).getTime() - from.getTime()) / 60_000 : null);

describe('card scheduling', () => {
  it('a card with no reviews is new and has no due date', () => {
    expect(scheduleOf([], created)).toMatchObject({ phase: 'new', due: null, reps: 0 });
  });

  it('a missed card comes back within minutes; a known one goes out for days', () => {
    const missed = scheduleOf([review(0, 1)], created);
    expect(missed.phase).toBe('learning');
    expect(minutesUntil(missed.due, at(0))).toBeLessThanOrEqual(10);
    const easy = scheduleOf([review(0, 4)], created);
    expect(easy.phase).toBe('review');
    expect(minutesUntil(easy.due, at(0))).toBeGreaterThan(24 * 60);
  });

  it('good reviews through the learning steps graduate the card, and each success spaces it further', () => {
    const first = scheduleOf([review(0, 3)], created);
    expect(first.phase).toBe('learning');
    const graduated = scheduleOf([review(0, 3), review(10, 3)], created);
    expect(graduated.phase).toBe('review');
    const gap1 = minutesUntil(graduated.due, at(10)) as number;
    const again = scheduleOf([review(0, 3), review(10, 3), review(10 + gap1, 3)], created);
    expect(minutesUntil(again.due, at(10 + gap1))).toBeGreaterThan(gap1);
  });

  it('a lapse sends a review card back to relearning and counts', () => {
    const base = [review(0, 3), review(10, 3)];
    const gap = minutesUntil(scheduleOf(base, created).due, at(10)) as number;
    const lapsed = scheduleOf([...base, review(10 + gap, 1)], created);
    expect(lapsed.phase).toBe('relearning');
    expect(lapsed.lapses).toBe(1);
  });

  it('replays reviews in time order, whatever order they are stored in', () => {
    const ordered = scheduleOf([review(0, 3), review(10, 3), review(3000, 1)], created);
    const shuffled = scheduleOf([review(3000, 1), review(0, 3), review(10, 3)], created);
    expect(shuffled).toEqual(ordered);
  });

  it('the next interval grows from Again to Easy', () => {
    const next = nextDueByRating([review(0, 3), review(10, 3)], created, at(4000));
    const waits = ([1, 2, 3, 4] as const).map((r) => new Date(next[r]).getTime());
    expect(waits).toEqual([...waits].sort((a, b) => a - b));
    expect(waits[0]).toBeLessThan(waits[3] as number);
  });

  it('says waits in plain words', () => {
    expect(formatInterval(30_000)).toBe('1 min');
    expect(formatInterval(10 * 60_000)).toBe('10 min');
    expect(formatInterval(5 * 3_600_000)).toBe('5 hours');
    expect(formatInterval(59.6 * 60_000)).toBe('1 hour');
    expect(formatInterval(23.8 * 3_600_000)).toBe('1 day');
    expect(formatInterval(86_400_000)).toBe('1 day');
    expect(formatInterval(8 * 86_400_000)).toBe('8 days');
    expect(formatInterval(65 * 86_400_000)).toBe('2 months');
    expect(formatInterval(548 * 86_400_000)).toBe('1.5 years');
  });
});

const entry = (id: string, schedule: Partial<CardSchedule>, createdAt = created): QueueEntry => ({
  id,
  createdAt,
  schedule: { phase: 'review', due: null, stability: 1, difficulty: 5, reps: 1, lapses: 0, lastReview: null, ...schedule },
});
const fresh = (id: string, minutes: number) => entry(id, { phase: 'new', reps: 0 }, at(minutes).toISOString());

describe('review queue', () => {
  const now = at(600);

  it('puts due learning cards first, then due reviews by how overdue, then new cards oldest first', () => {
    const q = reviewQueue(
      [fresh('n2', 5), entry('r-late', { due: at(500).toISOString() }), fresh('n1', 1), entry('l', { phase: 'learning', due: at(599).toISOString() }), entry('r-early', { due: at(100).toISOString() }), entry('r-future', { due: at(9000).toISOString() })],
      now,
      0,
    );
    expect(q.cards.map((c) => c.id)).toEqual(['l', 'r-early', 'r-late', 'n1', 'n2']);
    expect(q.nextDue).toBeNull();
  });

  it('lets in at most 20 new cards a day, counting those already introduced', () => {
    const many = Array.from({ length: 30 }, (_, i) => fresh(`n${String(i).padStart(2, '0')}`, i));
    expect(reviewQueue(many, now, 0).cards).toHaveLength(NEW_PER_DAY);
    const later = reviewQueue(many, now, 15);
    expect(later.cards).toHaveLength(5);
    expect(later.newWaiting).toBe(25);
    expect(reviewQueue(many, now, 25).cards).toHaveLength(0);
  });

  it('a learning card due soon comes early once nothing else is due, so the sitting can finish', () => {
    const soon = entry('l', { phase: 'learning', due: new Date(now.getTime() + LEARN_AHEAD_MS - 60_000).toISOString() });
    const far = entry('r', { due: at(5000).toISOString() });
    expect(reviewQueue([soon, far], now, 0).cards.map((c) => c.id)).toEqual(['l']);
    // with something due, it waits its turn
    expect(reviewQueue([soon, entry('d', { due: at(10).toISOString() })], now, 0).cards.map((c) => c.id)).toEqual(['d']);
  });

  it('when nothing is due, says when the next card is', () => {
    const q = reviewQueue([entry('r', { due: at(5000).toISOString() }), entry('s', { due: at(3000).toISOString() })], now, 0);
    expect(q.cards).toEqual([]);
    expect(q.nextDue).toBe(at(3000).toISOString());
  });

  it('counts the new cards introduced since the start of the day', () => {
    const start = at(0);
    expect(introducedSince([at(-5).toISOString(), at(1).toISOString(), null, at(400).toISOString()], start)).toBe(2);
  });
});

describe('room and credit', () => {
  it('asks for at most three cards, and never past the goal maximum', () => {
    expect(cardsToAsk(40, 0)).toBe(3);
    expect(cardsToAsk(40, 38)).toBe(2);
    expect(cardsToAsk(40, 40)).toBe(0);
    expect(cardsToAsk(40, 45)).toBe(0);
    expect(cardsToAsk(null, 1000)).toBe(3);
  });

  it('a session counts as a review at most once in the gap', () => {
    expect(creditable(null, t0)).toBe(true);
    expect(creditable(at(-10).toISOString(), t0)).toBe(false);
    expect(creditable(new Date(t0.getTime() - CREDIT_GAP_MS).toISOString(), t0)).toBe(true);
  });

  it('treats a card asked again in other spacing or emphasis as a duplicate', () => {
    expect(cardKey('State the **attention**  formula')).toBe(cardKey('state the attention formula'));
    expect(cardKey('State the attention formula')).not.toBe(cardKey('Define attention'));
  });
});
