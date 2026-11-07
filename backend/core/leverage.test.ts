import { describe, expect, it } from 'vitest';
import { indexChains } from './graph';
import { assignTiers, centrality, expectedEffort, goalRelevance, leverageOf, targetDepthFor } from './leverage';
import type { GoalContext } from './leverage';
import type { Chain, KnowledgeNode, NodeState } from './types';
import { emptyFsrs } from './fsrs';

const chain = (id: string, premises: string[], conclusion: string): Chain => ({ id, premises, conclusion, sources: [] });
const node = (id: string, kind: KnowledgeNode['kind'] = 'claim'): KnowledgeNode => ({ id, kind, name: id, statement: id, aliases: [], sources: [], status: 'verified' });
const state = (nodeId: string, depth: NodeState['depth']): NodeState => ({ nodeId, depth, targetDepth: 0, tier: 'archive', ownStatement: null, handle: null, fsrs: emptyFsrs(), firstSessionId: null });

const index = indexChains([chain('c1', ['a', 'b'], 'c'), chain('c2', ['c'], 'd'), chain('c3', ['c'], 'e')]);

const goals: GoalContext = {
  goals: new Map([
    ['g1', { id: 'g1', text: 'exam', priority: 2, status: 'active', createdAt: '', compiledAt: null }],
    ['g2', { id: 'g2', text: 'paused', priority: 5, status: 'paused', createdAt: '', compiledAt: null }],
  ]),
  capabilities: new Map([
    ['cap1', { id: 'cap1', goalId: 'g1', statement: 's', order: 0, masteredAt: null, request: null }],
    ['cap2', { id: 'cap2', goalId: 'g1', statement: 's', order: 1, masteredAt: null, request: null }],
    ['cap3', { id: 'cap3', goalId: 'g2', statement: 's', order: 0, masteredAt: null, request: null }],
  ]),
  targets: [
    { capabilityId: 'cap1', nodeId: 'c', depth: 3, idealDepth: 3, core: true, approvedDepth: null, simplified: null },
    { capabilityId: 'cap2', nodeId: 'c', depth: 2, idealDepth: 2, core: false, approvedDepth: null, simplified: null },
    { capabilityId: 'cap3', nodeId: 'a', depth: 5, idealDepth: 5, core: false, approvedDepth: null, simplified: null },
    { capabilityId: 'cap1', nodeId: 'd', depth: 1, idealDepth: 1, core: false, approvedDepth: null, simplified: null },
  ],
};

describe('leverage', () => {
  it('computes centrality with decay', () => {
    expect(centrality('a', index)).toBeCloseTo(1 + 0.5 + 0.5);
    expect(centrality('d', index)).toBe(0);
  });

  it('sums goal relevance only over active goals', () => {
    expect(goalRelevance('c', goals)).toBe(4);
    expect(goalRelevance('a', goals)).toBe(0);
  });

  it('takes the deepest active target depth', () => {
    expect(targetDepthFor('c', goals)).toBe(3);
    expect(targetDepthFor('a', goals)).toBe(0);
  });

  it('expected effort counts unowned premises on the cheapest chain and discounts terms', () => {
    expect(expectedEffort(node('c'), index, new Set())).toBe(3);
    expect(expectedEffort(node('c'), index, new Set(['a']))).toBe(2);
    expect(expectedEffort(node('a', 'term'), index, new Set())).toBe(0.5);
  });

  it('leverage is zero when the depth gap is closed', () => {
    const closed = leverageOf(node('c'), state('c', 3), index, new Set(['a', 'b']), goals);
    expect(closed.leverage).toBe(0);
    const open = leverageOf(node('c'), state('c', 1), index, new Set(['a', 'b']), goals);
    expect(open.leverage).toBeGreaterThan(0);
    expect(open.depthGap).toBe(2);
  });
});

describe('assignTiers', () => {
  it('follows the plan: explained or deeper is internalized, recognized is indexed, unplanned is archived', () => {
    const score = (nodeId: string, targetDepth: 0 | 1 | 2 | 3) => ({ nodeId, leverage: 1, goalRelevance: 1, centrality: 1, depthGap: 1, expectedEffort: 1, targetDepth });
    const tiers = assignTiers([score('derive', 3), score('explain', 2), score('recognize', 1), score('none', 0)]);
    expect(tiers.get('derive')).toBe('internalize');
    expect(tiers.get('explain')).toBe('internalize');
    expect(tiers.get('recognize')).toBe('index');
    expect(tiers.get('none')).toBe('archive');
  });
});
