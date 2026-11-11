import { describe, expect, it } from 'vitest';
import { indexChains } from './graph';
import { orderByDependencies, planCandidates } from './plan';
import { impliedPremiseScores, rankByInformation } from './probe';
import type { Chain } from './types';

const chain = (id: string, premises: string[], conclusion: string): Chain => ({ id, premises, conclusion, sources: [] });
// a, b -> c ; c, d -> e ; e -> f ; x -> y (unrelated) ; g has no chains
const index = indexChains([chain('c1', ['a', 'b'], 'c'), chain('c2', ['c', 'd'], 'e'), chain('c3', ['e'], 'f'), chain('c4', ['x'], 'y')]);

describe('planCandidates', () => {
  it('walks from the fringe toward the targets in layers', () => {
    const owned = new Set(['a', 'b']);
    const fringe = new Set(['c', 'y']); // y is on the fringe but irrelevant to the target
    const cands = planCandidates(['f'], owned, fringe, index);
    expect(cands.map((c) => `${c.nodeId}@${c.layer}`)).toEqual(['c@0']);
    // d is a root claim with no chain: unreachable, so e and f stay out
  });

  it('reaches targets once every premise is owned or a candidate', () => {
    const owned = new Set(['a', 'b', 'd']);
    const fringe = new Set(['c']);
    const cands = planCandidates(['f'], owned, fringe, index);
    expect(cands.map((c) => `${c.nodeId}@${c.layer}`)).toEqual(['c@0', 'e@1', 'f@2']);
    expect(cands.find((c) => c.nodeId === 'e')?.dependsOn).toEqual(['c']);
    expect(cands.find((c) => c.nodeId === 'f')?.onFringe).toBe(false);
  });

  it('ignores owned targets and nodes outside the target ancestry', () => {
    // f is owned, so nothing in its ancestry is needed; only y (and its ancestry) remains relevant
    const cands = planCandidates(['f', 'y'], new Set(['a', 'b', 'd', 'f', 'x']), new Set(['c', 'y']), index);
    expect(cands.map((c) => c.nodeId)).toEqual(['y']);
    const partial = planCandidates(['f', 'y'], new Set(['a', 'b', 'd', 'x']), new Set(['c', 'y']), index);
    expect(partial.map((c) => c.nodeId)).toEqual(['c', 'y', 'e', 'f']);
  });

  it('orders a chosen subset by dependencies, also through unchosen candidates', () => {
    const cands = new Map(planCandidates(['f'], new Set(['a', 'b', 'd']), new Set(['c']), index).map((c) => [c.nodeId, c]));
    expect(orderByDependencies(['f', 'c', 'e'], cands)).toEqual(['c', 'e', 'f']);
    expect(orderByDependencies(['f', 'c'], cands)).toEqual(['c', 'f']);
  });
});

describe('probe mechanics', () => {
  it('ranks targets by how many other targets depend on them', () => {
    const ranked = rankByInformation(['a', 'c', 'e', 'f', 'g'], index);
    expect(ranked[0]?.nodeId).toBe('a');
    expect(ranked[0]?.information).toBeCloseTo(1 + 0.5 + 0.25);
    expect(ranked.find((r) => r.nodeId === 'f')?.information).toBe(0);
    expect(ranked.find((r) => r.nodeId === 'g')?.information).toBe(0);
  });

  it('a good derivation implies the direct premises, a plain check implies nothing', () => {
    expect([...impliedPremiseScores('e', 0.9, 'derive', index).entries()]).toEqual([
      ['c', 0.81],
      ['d', 0.81],
    ]);
    expect(impliedPremiseScores('e', 0.9, 'check', index).size).toBe(0);
    expect(impliedPremiseScores('e', 0.5, 'derive', index).size).toBe(0);
  });
});

describe('a rough roadmap of a plan', () => {
  it('puts what an idea is built on before it and lays the ideas over the sessions', async () => {
    const { roadmap } = await import('./plan');
    const sessions = roadmap(
      [
        { id: 'nash', minutes: 30, dependsOn: ['profile', 'best'], weight: 1 },
        { id: 'profile', minutes: 12, dependsOn: [], weight: 3 },
        { id: 'best', minutes: 25, dependsOn: [], weight: 2 },
        { id: 'spe', minutes: 100, dependsOn: ['nash'], weight: 5 },
        { id: 'loop-a', minutes: 10, dependsOn: ['loop-b'], weight: 0 },
        { id: 'loop-b', minutes: 10, dependsOn: ['loop-a'], weight: 0 },
      ],
      45,
    );
    const order = [...sessions.keys()];
    expect(order.indexOf('profile')).toBeLessThan(order.indexOf('nash'));
    expect(order.indexOf('best')).toBeLessThan(order.indexOf('nash'));
    expect(order.indexOf('nash')).toBeLessThan(order.indexOf('spe'));
    expect(sessions.get('profile')).toEqual({ from: 1, to: 1 });
    expect(sessions.get('best')).toEqual({ from: 1, to: 1 }); // minutes 12 to 37
    expect(sessions.get('nash')).toEqual({ from: 1, to: 2 }); // minutes 37 to 67: it runs on into the second session
    expect(sessions.get('spe')).toEqual({ from: 2, to: 4 }); // 100 minutes are more than two sessions
    expect(sessions.size).toBe(6); // ideas that wait for each other are still placed
    // the last session is the plan's session count: 187 minutes are five sessions of 45
    expect(Math.max(...[...sessions.values()].map((v) => v.to))).toBe(Math.ceil(187 / 45));
  });

  it('takes ideas of the same weight in the order given, whatever their ids', async () => {
    const { roadmap } = await import('./plan');
    const order = (ids: string[]) => [...roadmap(ids.map((id) => ({ id, minutes: 10, dependsOn: [], weight: 1 })), 45).keys()];
    expect(order(['zeta', 'alpha', 'mid'])).toEqual(['zeta', 'alpha', 'mid']);
    expect(order(['alpha', 'mid', 'zeta'])).toEqual(['alpha', 'mid', 'zeta']);
  });
});
