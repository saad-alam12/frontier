import { describe, expect, it } from 'vitest';
import { examClock, examMinutes, examReport } from './exam';

describe('exam mode (R7 B7)', () => {
  it('times a mock exam at about twelve minutes a problem, never longer than the real exam', () => {
    expect(examMinutes(5, null)).toBe(60);
    expect(examMinutes(5, 45)).toBe(45);
    expect(examMinutes(1, 5)).toBe(10);
  });

  it('is over when handed in or out of time', () => {
    const start = '2026-11-12T10:00:00.000Z';
    expect(examClock({ createdAt: start, minutes: 60, handedInAt: null }, new Date('2026-11-12T10:59:00Z'))).toEqual({ endsAt: '2026-11-12T11:00:00.000Z', over: false });
    expect(examClock({ createdAt: start, minutes: 60, handedInAt: null }, new Date('2026-11-12T11:00:00Z')).over).toBe(true);
    expect(examClock({ createdAt: start, minutes: 60, handedInAt: '2026-11-12T10:20:00Z' }, new Date('2026-11-12T10:21:00Z')).over).toBe(true);
  });

  it('reports points, a score per skill and the ideas to work on; an unanswered problem counts zero', () => {
    const report = examReport(
      [
        { nodeIds: ['a', 'b'], answered: true, score: 8, ideaScores: new Map([['a', 9], ['b', 6]]) },
        { nodeIds: ['c'], answered: false, score: null, ideaScores: new Map() },
        { nodeIds: ['a'], answered: true, score: null, ideaScores: new Map() },
      ],
      [
        { id: 's1', statement: 'Find equilibria', nodeIds: ['a', 'b'] },
        { id: 's2', statement: 'Use dominance', nodeIds: ['c'] },
        { id: 's3', statement: 'Backward induction', nodeIds: ['d'] },
      ],
    );
    expect(report).toMatchObject({ points: 8, maxPoints: 30, answered: 2, pending: 1 });
    expect(report.skills).toEqual([
      { id: 's1', statement: 'Find equilibria', tested: 2, score: 7.5 },
      { id: 's2', statement: 'Use dominance', tested: 1, score: 0 },
      { id: 's3', statement: 'Backward induction', tested: 0, score: null },
    ]);
    expect(report.weak.sort()).toEqual(['b', 'c']);
  });
});
