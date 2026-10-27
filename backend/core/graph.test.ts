import { describe, expect, it } from 'vitest';
import { ancestors, dependents, indexChains, neighbourhood } from './graph';
import { implicitCreditWeights } from './implicitCredit';
import { computeFringe } from './ownership';
import type { Chain, KnowledgeNode } from './types';

const chain = (id: string, premises: string[], conclusion: string): Chain => ({ id, premises, conclusion, sources: [] });
const node = (id: string, kind: KnowledgeNode['kind'] = 'claim'): KnowledgeNode => ({ id, kind, name: id, statement: id, aliases: [], sources: [], status: 'verified' });

// a, b -> c ; c, d -> e ; e -> f ; g (term, no chains)
const chains = [chain('c1', ['a', 'b'], 'c'), chain('c2', ['c', 'd'], 'e'), chain('c3', ['e'], 'f')];
const index = indexChains(chains);

describe('graph helpers', () => {
  it('finds ancestors transitively', () => {
    expect([...ancestors('f', index)].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect([...ancestors('a', index)]).toEqual([]);
  });

  it('picks the nearest neighbourhood deterministically, premises and dependents hop by hop', () => {
    const near = neighbourhood('e', index, 4);
    expect(near.nodeIds).toEqual(['e', 'c', 'd', 'f']);
    expect(near.edges.sort()).toEqual([['c', 'e'], ['d', 'e'], ['e', 'f']].sort());
    const wide = neighbourhood('e', index, 10, ['g']);
    expect(wide.nodeIds.sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(wide.edges).toHaveLength(5);
  });

  it('finds dependents with decay', () => {
    const d = dependents('a', index, 0.5);
    expect(d.get('c')).toBe(1);
    expect(d.get('e')).toBe(0.5);
    expect(d.get('f')).toBe(0.25);
    expect(d.has('d')).toBe(false);
  });
});

describe('implicit credit', () => {
  it('pays decaying credit up to two hops', () => {
    const w = implicitCreditWeights('f', index);
    expect(w.get('e')).toEqual({ weight: 0.5, hops: 1 });
    expect(w.get('c')).toEqual({ weight: 0.25, hops: 2 });
    expect(w.get('d')).toEqual({ weight: 0.25, hops: 2 });
    expect(w.has('a')).toBe(false);
  });

  it('respects custom factor and hops', () => {
    const w = implicitCreditWeights('f', index, { factor: 0.8, maxHops: 3 });
    expect(w.get('a')?.weight).toBeCloseTo(0.512);
  });
});

describe('fringe', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => node(id)).concat([node('g', 'term')]);

  it('contains unowned nodes whose premises are all owned', () => {
    const fringe = computeFringe({ nodes, index, owned: new Set(['a', 'b']), goalNeeded: new Set() });
    expect([...fringe]).toEqual(['c']);
  });

  it('moves up as nodes become owned and excludes owned nodes', () => {
    const fringe = computeFringe({ nodes, index, owned: new Set(['a', 'b', 'c', 'd']), goalNeeded: new Set() });
    expect([...fringe]).toEqual(['e']);
  });

  it('includes root terms only when a goal needs them', () => {
    expect(computeFringe({ nodes, index, owned: new Set(), goalNeeded: new Set() }).has('g')).toBe(false);
    expect(computeFringe({ nodes, index, owned: new Set(), goalNeeded: new Set(['g']) }).has('g')).toBe(true);
    // root claims with no chains are never on the fringe: they need a source or a term chain first
    expect(computeFringe({ nodes, index, owned: new Set(), goalNeeded: new Set(['a']) }).has('a')).toBe(false);
  });
});
