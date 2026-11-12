import { describe, expect, it } from 'vitest';
import { openDatabase } from '../store/db';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { recordEvidence } from './evidence';
import { weekReview } from './weekReview';

/** Wednesday 11 November 2026, noon local time. */
const NOW = new Date(2026, 10, 11, 12);
const day = (d: number, h = 10) => new Date(2026, 10, d, h).toISOString();

function setup() {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const id = (k: string) => ids.get(k) as string;
  return { db, id };
}

describe('the weekly review', () => {
  it('covers Monday to Sunday of the week asked for, and no further back than it keeps', () => {
    const { db } = setup();
    const week = weekReview(db, null, NOW);
    expect([week.start, week.end, week.current]).toEqual(['2026-11-09', '2026-11-15', true]);
    const last = weekReview(db, '2026-11-04', NOW);
    expect([last.start, last.end, last.current]).toEqual(['2026-11-02', '2026-11-08', false]);
    // a week in the future is this week
    expect(weekReview(db, '2027-01-01', NOW).start).toBe('2026-11-09');
    expect(weekReview(db, '2020-01-01', NOW).hasEarlier).toBe(false);
  });

  it('lists what was learned, what faded and where the learner was too sure', () => {
    const { db, id } = setup();
    // learned long ago and left alone: faded by now
    recordEvidence(db, { nodeId: id('strategy'), kind: 'explain', score: 0.9, reasoning: 'old', at: day(1, 9).replace('2026-11', '2026-08') });
    // learned this week
    recordEvidence(db, { nodeId: id('bestResponse'), kind: 'explain', score: 0.9, reasoning: 'new', at: day(10) });
    // answered sure and wrong this week, twice
    recordEvidence(db, { nodeId: id('nash'), kind: 'check', score: 0.2, reasoning: 'wrong', confidence: 0.9, at: day(9) });
    recordEvidence(db, { nodeId: id('nash'), kind: 'check', score: 0.1, reasoning: 'wrong', confidence: 0.66, at: day(10) });
    // last week's answer is not this week's
    recordEvidence(db, { nodeId: id('payoff'), kind: 'explain', score: 0.9, reasoning: 'last week', at: day(4) });

    const week = weekReview(db, null, NOW);
    expect(week.learned.map((l) => l.name)).toContain('Best response');
    expect(week.learned.map((l) => l.name)).not.toContain('Payoff function');
    expect(week.faded.map((f) => f.nodeId)).toContain(id('strategy'));
    expect(week.faded.every((f) => f.recall < 0.7)).toBe(true);
    expect(week.tooSure).toEqual([{ nodeId: id('nash'), name: 'Nash equilibrium', count: 2 }]);
    expect(week.sure).toEqual({ answers: 2, right: 0 });
    expect(week.answers).toBe(3);
    // no time logged: the suggestion is to study at all
    expect(week.suggestion.kind).toBe('start');

    const last = weekReview(db, '2026-11-04', NOW);
    expect(last.learned.map((l) => l.name)).toEqual(['Payoff function']);
    expect(last.tooSure).toEqual([]);
  });
});
