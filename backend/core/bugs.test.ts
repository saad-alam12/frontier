import { describe, expect, it } from 'vitest';
import { matchMisconception, sameMisconception } from './bugs';

describe('the same misconception, said again', () => {
  it('matches the same belief reworded, not a different one about the same idea', () => {
    const recorded = 'Thinks an equilibrium is the best outcome for both players.';
    expect(sameMisconception(recorded, 'thinks an equilibrium is the best outcome for both players')).toBe(true);
    expect(sameMisconception(recorded, 'Believes the equilibrium outcome is the best one for both of the players.')).toBe(true);
    expect(sameMisconception(recorded, 'Checks only one player when testing for an equilibrium.')).toBe(false);
    // too few words to tell
    expect(sameMisconception('Wrong sign.', 'Wrong order.')).toBe(false);
  });

  it('finds an open one first, else the one that ended last', () => {
    const bugs = [
      { id: 'old', description: 'Thinks an equilibrium is the best outcome for both players.', resolvedAt: '2026-10-01T00:00:00Z' },
      { id: 'later', description: 'Believes the equilibrium is the best outcome for both players.', resolvedAt: '2026-10-20T00:00:00Z' },
      { id: 'other', description: 'Checks only one player when testing a profile.', resolvedAt: null },
    ];
    expect(matchMisconception('The equilibrium is the best outcome for both players, they think.', bugs)?.id).toBe('later');
    expect(matchMisconception('Checks only one player when testing a profile', bugs)?.id).toBe('other');
    expect(matchMisconception('Confuses payoffs with strategies entirely.', bugs)).toBeNull();
  });
});
