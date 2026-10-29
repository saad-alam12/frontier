import { describe, expect, it } from 'vitest';
import { defaultBudget, weeksUntil } from './budgetDefaults';

describe('default budgets', () => {
  const now = new Date('2026-10-29T12:00:00Z').getTime();
  it('gives a course a weekly rhythm to its date and anything else ten hours', () => {
    expect(defaultBudget('course', '2026-12-24', now)).toEqual({ mode: 'rate', hours: 4, per: 'week', length: 8, lengthUnit: 'weeks' });
    expect(defaultBudget('course', null, now)).toEqual({ mode: 'rate', hours: 4, per: 'week', length: 12, lengthUnit: 'weeks' });
    expect(defaultBudget('personal', '2026-12-24', now)).toEqual({ mode: 'total', hours: 10 });
    expect(defaultBudget(null, null, now)).toEqual({ mode: 'total', hours: 10 });
  });
  it('counts whole weeks to a date', () => {
    expect(weeksUntil('2026-11-05', now)).toBe(1);
    expect(weeksUntil('2026-10-01', now)).toBe(0);
    expect(weeksUntil(null, now)).toBeNull();
  });
});
