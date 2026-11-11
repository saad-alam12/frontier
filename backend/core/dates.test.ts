// The owner is in Germany: every test here runs in that time zone, where local midnight is the day
// before in UTC and two days a year are not 24 hours long. (Each test file has its own process.)
process.env['TZ'] = 'Europe/Berlin';

import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, localDate, startOfDay, weekStart } from './dates';

describe('calendar arithmetic in local time', () => {
  it('a week starts on its Monday, by the local date', () => {
    const wednesday = new Date(2026, 10, 11, 9, 30); // 11 November 2026
    expect(localDate(weekStart(wednesday))).toBe('2026-11-09');
    expect(weekStart(wednesday).toISOString().slice(0, 10)).toBe('2026-11-08'); // the UTC date is the Sunday: never use it as a label
    expect(localDate(weekStart(new Date(2026, 10, 9, 0, 0)))).toBe('2026-11-09');
    expect(localDate(weekStart(new Date(2026, 10, 15, 23, 59)))).toBe('2026-11-09');
  });

  it('steps over the days the clocks change without losing or repeating one', () => {
    // spring forward on 29 March 2026, back on 25 October 2026
    for (const start of [new Date(2026, 2, 23), new Date(2026, 9, 19)]) {
      const days = Array.from({ length: 14 }, (_, i) => addDays(start, i));
      expect(new Set(days.map(localDate)).size).toBe(14);
      expect(days.every((d) => d.getHours() === 0)).toBe(true);
      expect(days.map((d) => d.getDay())).toEqual([1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6, 0]);
    }
    expect(localDate(addDays(new Date(2026, 2, 28), 1))).toBe('2026-03-29');
  });

  it('counts calendar days between two moments', () => {
    expect(daysBetween(new Date(2026, 2, 28, 23, 0), new Date(2026, 2, 30, 1, 0))).toBe(2);
    expect(daysBetween(new Date(2026, 9, 24, 12), new Date(2026, 9, 26, 12))).toBe(2);
    expect(daysBetween(new Date(2026, 0, 1, 8), new Date(2026, 0, 1, 22))).toBe(0);
    expect(startOfDay(new Date(2026, 5, 3, 17, 45)).getHours()).toBe(0);
  });
});
