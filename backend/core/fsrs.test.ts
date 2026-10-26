import { describe, expect, it } from 'vitest';
import { applyReview, emptyFsrs, isDue, recallProbability, scoreToRating } from './fsrs';

const t0 = new Date('2026-01-01T00:00:00Z');
const days = (n: number) => new Date(t0.getTime() + n * 86_400_000);

describe('fsrs wrapper', () => {
  it('maps scores to ratings', () => {
    expect(scoreToRating(0)).toBe(1);
    expect(scoreToRating(0.5)).toBe(2);
    expect(scoreToRating(0.7)).toBe(3);
    expect(scoreToRating(0.95)).toBe(4);
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
    expect(half.lastReview).toBe(days(5).toISOString());
  });

  it('a failure counts a lapse and lowers stability', () => {
    const base = applyReview(applyReview(emptyFsrs(), 0.9, t0), 0.9, days(4));
    const failed = applyReview(base, 0.1, days(20));
    expect(failed.lapses).toBe(1);
    expect(failed.stability).toBeLessThan(base.stability);
  });
});
