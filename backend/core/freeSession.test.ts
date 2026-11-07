import { describe, expect, it } from 'vitest';
import { chosenAim, joinNames, missingPremises, teachingOrder } from './freeSession';
import type { PremiseSets } from './freeSession';

// attention builds on dot product and softmax; softmax on exponentials; a second way into attention
// goes through a lookup table the learner owns
const chains: Record<string, string[][]> = {
  attention: [['dot', 'softmax']],
  softmax: [['exp']],
  transformer: [['attention', 'mlp'], ['lookup']],
};
const sets: PremiseSets = (id) => chains[id] ?? [];

describe('choosing what to learn', () => {
  it('warns about premises the learner does not own and the session does not teach', () => {
    expect(missingPremises(['attention'], new Set(), sets)).toEqual([
      { id: 'dot', neededBy: ['attention'] },
      { id: 'softmax', neededBy: ['attention'] },
    ]);
    // a premise in the session counts as covered; its own premises are then what is missing
    expect(missingPremises(['softmax', 'attention'], new Set(['dot']), sets)).toEqual([{ id: 'exp', neededBy: ['softmax'] }]);
    // a starting point needs nothing
    expect(missingPremises(['exp'], new Set(), sets)).toEqual([]);
  });

  it('needs nothing when any one chain is covered, and otherwise names the nearest chain’s gaps', () => {
    expect(missingPremises(['transformer'], new Set(['lookup']), sets)).toEqual([]);
    expect(missingPremises(['transformer'], new Set(['attention']), (id) => (id === 'transformer' ? [['attention', 'mlp'], ['lookup', 'index']] : []))).toEqual([{ id: 'mlp', neededBy: ['transformer'] }]);
  });

  it('collects the ideas that need the same premise', () => {
    const shared: PremiseSets = (id) => (id === 'a' || id === 'b' ? [['base']] : []);
    expect(missingPremises(['a', 'b'], new Set(), shared)).toEqual([{ id: 'base', neededBy: ['a', 'b'] }]);
  });

  it('aims where it was asked, and always past what the learner has', () => {
    expect(chosenAim(0, 0)).toBe(2); // nothing asked: own it
    expect(chosenAim(1, 0)).toBe(1);
    expect(chosenAim(3, 1)).toBe(3);
    expect(chosenAim(2, 2)).toBe(3); // an idea you explain, chosen again, goes deeper
    expect(chosenAim(4, 5)).toBe(5);
  });

  it('teaches an idea after the chosen ideas it builds on, otherwise in the order chosen', () => {
    const { order, dependsOn } = teachingOrder(['attention', 'mlp', 'softmax', 'dot'], sets);
    expect(order).toEqual(['dot', 'softmax', 'attention', 'mlp']);
    expect(dependsOn.get('attention')).toEqual(['dot', 'softmax']);
    expect(dependsOn.get('mlp')).toEqual([]);
  });

  it('joins names in plain English', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
  });
});
