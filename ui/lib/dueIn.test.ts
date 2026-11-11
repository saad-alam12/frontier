import { describe, expect, it } from 'vitest';
import { dueIn } from './dueIn';

describe('how far a date is', () => {
  const now = new Date(2026, 10, 11, 23, 30); // 11 November 2026, late in the evening
  it('counts calendar days from today', () => {
    expect(dueIn('2026-11-11', now)).toBe('today');
    expect(dueIn('2026-11-12', now)).toBe('tomorrow');
    expect(dueIn('2026-12-04', now)).toBe('in 23 days');
    expect(dueIn('2027-02-10', now)).toBe('in 13 weeks');
    expect(dueIn('2026-11-10', now)).toBe('passed');
  });
  it('says nothing without a usable date', () => {
    expect(dueIn(null, now)).toBeNull();
    expect(dueIn('soon', now)).toBeNull();
  });
});
