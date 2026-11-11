// Stats in the owner's time zone (Germany): see backend/core/dates.test.ts for why the zone is set here.
process.env['TZ'] = 'Europe/Berlin';

import { describe, expect, it } from 'vitest';
import { openDatabase } from '../store/db';
import { logTime } from '../store/activity';
import { createGoal } from '../store/goals';
import { calendar, growthSeries, statsView } from './stats';

describe('Stats dates in local time', () => {
  it('the calendar has every day of twelve weeks once, also across the clock change, starting on a Monday', () => {
    const now = new Date(2026, 3, 8, 12); // Wednesday 8 April 2026; the clocks changed on 29 March
    const days = calendar([{ minutes: 30, span: { endedAt: new Date(2026, 2, 29, 15).toISOString() } }, { minutes: 20, span: { endedAt: new Date(2026, 3, 8, 0, 30).toISOString() } }], now);
    expect(days).toHaveLength(84);
    expect(new Set(days.map((d) => d.date)).size).toBe(84);
    expect(new Date(`${days[0]?.date}T12:00:00`).getDay()).toBe(1);
    expect(days[83]?.date).toBe('2026-04-12'); // the Sunday of this week
    expect(days.find((d) => d.date === '2026-03-29')?.minutes).toBe(30); // the 23-hour day is there, with its study
    expect(days.find((d) => d.date === '2026-04-08')?.minutes).toBe(20); // half past midnight local is today, not yesterday
  });

  it('what you know ends today, with everything up to now', () => {
    const now = new Date(2026, 10, 11, 18);
    const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
    for (const history of [3, 59, 61, 608]) {
      const series = growthSeries(
        [
          { nodeId: 'a', at: at(history), from: 0, to: 2 },
          { nodeId: 'b', at: at(1), from: 0, to: 2 },
          { nodeId: 'c', at: at(0.01), from: 0, to: 3 },
        ],
        at(history),
        now,
      );
      const last = series[series.length - 1];
      expect(last, `history of ${history} days`).toEqual({ date: '2026-11-11', recognized: 3, owned: 3, deep: 1 });
      expect(series.every((p) => p.date <= '2026-11-11')).toBe(true);
      expect(series.length).toBeLessThanOrEqual(62);
    }
  });

  it('weeks are labelled with their Monday', () => {
    const db = openDatabase(':memory:');
    const goal = createGoal(db, { text: 'Learn it', priority: 1 });
    db.prepare("UPDATE goals SET status = 'active' WHERE id = ?").run(goal.id);
    const now = new Date(2026, 10, 11, 18); // Wednesday 11 November 2026
    logTime(db, 'session', { goalId: goal.id }, 600, new Date(2026, 10, 9, 0, 20)); // Monday, twenty past midnight
    const weeks = statsView(db, { goalId: null, topicId: null, range: '30d' }, now).weeks;
    const thisWeek = weeks[weeks.length - 1];
    expect(thisWeek?.start).toBe('2026-11-09');
    expect(thisWeek?.minutes[goal.id]).toBe(10);
    expect(weeks.every((w) => new Date(`${w.start}T12:00:00`).getDay() === 1)).toBe(true);
  });
});
