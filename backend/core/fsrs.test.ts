import { describe, expect, it } from 'vitest';
import { applyReview, emptyFsrs, isDue, recallProbability, scoreToRating } from './fsrs';

const t0 = new Date('2026-01-01T00:00:00Z');
const days = (n: number) => new Date(t0.getTime() + n * 86_400_000);

describe('fsrs wrapper', () => {
  it('maps scores to ratings', () => {
    expect(scoreToRating(0)).toBe(1);
    expect(scoreToRating(0.5)).toBe(1); // below the pass mark is a failed recall, whatever its size
    expect(scoreToRating(0.69)).toBe(1);
    expect(scoreToRating(0.7)).toBe(2);
    expect(scoreToRating(0.8)).toBe(3);
    expect(scoreToRating(0.95)).toBe(4);
  });

  it('a failed answer never lengthens the time until the idea comes back', () => {
    const base = applyReview(emptyFsrs(), 0.9, t0);
    for (const score of [0.1, 0.45, 0.6, 0.69]) {
      const after = applyReview(base, score, days(20));
      expect(after.stability, `score ${score}`).toBeLessThan(base.stability);
      expect(after.lapses).toBe(1);
    }
    expect(applyReview(base, 0.7, days(20)).stability).toBeGreaterThan(base.stability);
  });

  it('counts the real time between two reviews, not calendar days', () => {
    const minutes = (from: string, n: number) => new Date(new Date(from).getTime() + n * 60_000);
    // twenty minutes apart, once within a day and once across midnight UTC: the same result
    const within = applyReview(applyReview(emptyFsrs(), 0.8, new Date('2026-03-10T10:00:00Z')), 0.9, minutes('2026-03-10T10:00:00Z', 20));
    const across = applyReview(applyReview(emptyFsrs(), 0.8, new Date('2026-03-10T23:50:00Z')), 0.9, minutes('2026-03-10T23:50:00Z', 20));
    expect(across.stability).toBeCloseTo(within.stability, 6);
    // and a review after a real gap grows the memory more than one right away
    const base = applyReview(emptyFsrs(), 0.8, t0);
    expect(applyReview(base, 0.9, days(3)).stability).toBeGreaterThan(applyReview(base, 0.9, days(0.01)).stability);
  });

  it('survives a clock that was set back', () => {
    const base = applyReview(emptyFsrs(), 0.9, days(5));
    expect(() => applyReview(base, 0.9, days(2))).not.toThrow();
  });

  it('has zero recall before any review and high recall right after', () => {
    expect(recallProbability(emptyFsrs(), t0)).toBe(0);
    const s = applyReview(emptyFsrs(), 0.8, t0);
    expect(recallProbability(s, t0)).toBeCloseTo(1, 2);
    expect(s.due).not.toBeNull();
    expect(isDue(s, t0)).toBe(false);
    expect(isDue(s, days(365))).toBe(true);
  });

  it('recall decays over time and grows with repeated good reviews', () => {
    const once = applyReview(emptyFsrs(), 0.8, t0);
    const later = recallProbability(once, days(30));
    expect(later).toBeLessThan(0.8);
    const twice = applyReview(once, 0.8, days(3));
    expect(twice.stability).toBeGreaterThan(once.stability);
    expect(recallProbability(twice, days(33))).toBeGreaterThan(later);
  });

  it('partial credit moves stability a fraction of the way', () => {
    const base = applyReview(emptyFsrs(), 0.8, t0);
    const full = applyReview(base, 0.9, days(5));
    const half = applyReview(base, 0.9, days(5), 0.5);
    expect(half.stability).toBeGreaterThan(base.stability);
    expect(half.stability).toBeLessThan(full.stability);
    expect(half.stability).toBeCloseTo(base.stability + 0.5 * (full.stability - base.stability), 6);
    // the clock moves halfway too: from day 0 to day 2.5
    expect(half.lastReview).toBe(new Date((t0.getTime() + days(5).getTime()) / 2).toISOString());
  });

  it('a light touch long after learning does not make an idea look freshly reviewed', () => {
    const base = applyReview(emptyFsrs(), 0.9, t0);
    const touched = applyReview(base, 0.6, days(60), 0.2);
    const now = days(60);
    expect(recallProbability(touched, now)).toBeGreaterThan(recallProbability(base, now));
    expect(recallProbability(touched, now)).toBeLessThan(0.9);
    expect(touched.lastReview).toBe(days(12).toISOString()); // 20% of the way from day 0 to day 60
  });

  it('a failure counts a lapse and lowers stability', () => {
    const base = applyReview(applyReview(emptyFsrs(), 0.9, t0), 0.9, days(4));
    const failed = applyReview(base, 0.1, days(20));
    expect(failed.lapses).toBe(1);
    expect(failed.stability).toBeLessThan(base.stability);
  });
});
