import { describe, expect, it } from 'vitest';
import { derivationPath } from './derivation';
import { indexChains } from './graph';
import type { Chain } from './types';

const chain = (premises: string[], conclusion: string): Chain => ({ id: `${premises.join('+')}>${conclusion}`, premises, conclusion, sources: [] });

describe('derivation path', () => {
  it('walks from owned grounds to the idea, taking the chain that needs the least new', () => {
    // nash ← (profile, br); br ← (strategy, payoff); profile ← strategy; nash ← (bigLemma) is the costly alternative
    const index = indexChains([chain(['profile', 'br'], 'nash'), chain(['strategy', 'payoff'], 'br'), chain(['strategy'], 'profile'), chain(['lemmaA', 'lemmaB', 'lemmaC'], 'nash')]);
    const path = derivationPath('nash', index, new Set(['strategy', 'payoff']));
    expect(path.map((s) => s.nodeId)).toEqual(['strategy', 'profile', 'payoff', 'br', 'nash']);
    expect(path.at(-1)?.premises).toEqual(['profile', 'br']);
    expect(path.filter((s) => s.owned).map((s) => s.nodeId)).toEqual(['strategy', 'payoff']);
  });

  it('stops at an owned idea and survives cycles', () => {
    const index = indexChains([chain(['b'], 'a'), chain(['a'], 'b'), chain(['c'], 'a')]);
    expect(derivationPath('a', index, new Set(['c'])).map((s) => s.nodeId)).toEqual(['c', 'a']);
    expect(derivationPath('a', index, new Set(['a']))).toEqual([{ nodeId: 'a', premises: [], owned: true }]);
    expect(derivationPath('a', index, new Set()).map((s) => s.nodeId)).toContain('a');
  });
});
