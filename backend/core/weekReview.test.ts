import { describe, expect, it } from 'vitest';
import { suggestChange, tooSure } from './weekReview';

const goal = (over: Partial<Parameters<typeof suggestChange>[0]['goals'][number]> = {}) => ({ goalId: 'g1', title: 'Game theory', minutes: 120, weeklyTarget: 120, roomMinutes: null, ...over });

describe('too sure', () => {
  it('counts answers given fairly sure or sure that were wrong, per idea', () => {
    const answers = [
      { nodeId: 'a', score: 0.2, confidence: 0.9 },
      { nodeId: 'a', score: 0.1, confidence: 0.66 },
      { nodeId: 'b', score: 0.3, confidence: 0.9 },
      { nodeId: 'b', score: 0.3, confidence: 0.33 }, // a guess is allowed to be wrong
      { nodeId: 'c', score: 0.8, confidence: 0.9 },
      { nodeId: 'd', score: 0.2, confidence: null },
    ];
    expect(tooSure(answers)).toEqual([
      { nodeId: 'a', count: 2 },
      { nodeId: 'b', count: 1 },
    ]);
  });
});

describe('the one suggested change', () => {
  const base = { minutes: 200, elapsed: 1, goals: [goal()], faded: 0, tooSure: [] };
  it('asks for any study first', () => {
    expect(suggestChange({ ...base, minutes: 0 }).kind).toBe('start');
  });
  it('catches up the goal furthest behind its rhythm, judged on the days gone', () => {
    const s = suggestChange({ ...base, goals: [goal({ minutes: 20 }), goal({ goalId: 'g2', title: 'Stats', minutes: 0, weeklyTarget: 240 })] });
    expect(s).toMatchObject({ kind: 'catchUp', goalId: 'g2' });
    expect(s.text).toMatch(/^Stats is behind its rhythm: 0 of about 240 minutes/);
    // two days into the week, 40 of 120 minutes is on pace
    expect(suggestChange({ ...base, elapsed: 2 / 7, goals: [goal({ minutes: 40 })] }).kind).toBe('keep');
  });
  it('checks ideas answered sure and wrong before new material', () => {
    const s = suggestChange({ ...base, tooSure: [{ nodeId: 'a', name: 'Nash equilibrium', count: 2 }, { nodeId: 'b', name: 'Best response', count: 1 }] });
    expect(s).toMatchObject({ kind: 'checkFirst', nodeIds: ['a', 'b'] });
    expect(s.text).toContain('wrong 3 times, most on Nash equilibrium and Best response');
  });
  it('practises when many ideas faded, uses freed time, or keeps the rhythm', () => {
    expect(suggestChange({ ...base, faded: 6 }).kind).toBe('practise');
    expect(suggestChange({ ...base, goals: [goal({ roomMinutes: 90 })] })).toMatchObject({ kind: 'useTime', goalId: 'g1' });
    expect(suggestChange(base).kind).toBe('keep');
  });
});
