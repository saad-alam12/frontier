import { describe, expect, it } from 'vitest';
import { fillTime } from './timePlan';

const goal = (mode: 'build' | 'deepen' | 'consolidate', fading = 0) => ({ goalId: 'g1', mode, fading });

describe('filling the time the learner has (R7 A4)', () => {
  it('flashcards first, never more than a third of the time, then a session fitted to what is left', () => {
    expect(fillTime({ minutes: 30, cardsDue: 60, goal: goal('build') })).toEqual([
      { kind: 'cards', minutes: 10, cards: 40 },
      { kind: 'session', minutes: 20, goalId: 'g1' },
    ]);
    expect(fillTime({ minutes: 15, cardsDue: 6, goal: goal('build') })).toEqual([
      { kind: 'cards', minutes: 5, cards: 6 },
      { kind: 'session', minutes: 10, goalId: 'g1' },
    ]);
    expect(fillTime({ minutes: 45, cardsDue: 0, goal: goal('deepen') })).toEqual([{ kind: 'session', minutes: 45, goalId: 'g1' }]);
  });

  it('practice when ideas are fading, a few problems, and a session in the time that is left', () => {
    expect(fillTime({ minutes: 60, cardsDue: 0, goal: goal('consolidate', 6) })).toEqual([
      { kind: 'practice', minutes: 15, goalId: 'g1', problems: 3 },
      { kind: 'session', minutes: 45, goalId: 'g1' },
    ]);
    expect(fillTime({ minutes: 15, cardsDue: 4, goal: goal('consolidate', 9) })).toEqual([
      { kind: 'cards', minutes: 5, cards: 4 },
      { kind: 'practice', minutes: 10, goalId: 'g1', problems: 2 },
    ]);
  });

  it('with no goal, the time is all flashcards; with nothing due, nothing', () => {
    expect(fillTime({ minutes: 30, cardsDue: 200, goal: null })).toEqual([{ kind: 'cards', minutes: 30, cards: 120 }]);
    expect(fillTime({ minutes: 30, cardsDue: 0, goal: null })).toEqual([]);
  });
});
