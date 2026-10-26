import { describe, expect, it } from 'vitest';
import { planMerge } from './merge';
import type { MergeInput } from './merge';
import type { Chain, KnowledgeNode } from './types';

const existingNode: KnowledgeNode = {
  id: 'node_nash',
  kind: 'term',
  name: 'Nash equilibrium',
  statement: 'No player can gain by deviating alone.',
  aliases: ['NE'],
  sources: [{ sourceId: 'srcA', locator: 'p3' }],
  status: 'verified',
};
const existingBr: KnowledgeNode = { ...existingNode, id: 'node_br', name: 'Best response', aliases: [], statement: 'Best available strategy given the others.' };
const existingChain: Chain = { id: 'chain_1', premises: ['node_br'], conclusion: 'node_nash', sources: [{ sourceId: 'srcA', locator: 'p3' }] };

function counter() {
  let n = 0;
  return (prefix: 'node' | 'chain') => `${prefix}_${++n}`;
}

function base(): MergeInput {
  return {
    sourceId: 'srcB',
    extractedNodes: [],
    extractedChains: [],
    identities: new Map(),
    existingNodes: new Map([
      [existingNode.id, existingNode],
      [existingBr.id, existingBr],
    ]),
    existingChains: [existingChain],
    newId: counter(),
  };
}

describe('planMerge', () => {
  it('creates new nodes with citations and resolves chains to their ids', () => {
    const plan = planMerge({
      ...base(),
      extractedNodes: [
        { tempId: 'n1', kind: 'claim', name: 'Dominant implies Nash', statement: 's', aliases: [], locator: 'p7' },
        { tempId: 'n2', kind: 'term', name: 'Dominant strategy', statement: 's', aliases: ['strictly dominant'], locator: 'p6' },
      ],
      extractedChains: [{ premises: ['n2', 'node_nash'], conclusion: 'n1', locator: 'p7' }],
    });
    expect(plan.newNodes).toHaveLength(2);
    expect(plan.newNodes[0]?.sources).toEqual([{ sourceId: 'srcB', locator: 'p7' }]);
    expect(plan.newChains).toHaveLength(1);
    expect(plan.newChains[0]?.premises.sort()).toEqual(['node_2', 'node_nash']);
    expect(plan.newChains[0]?.conclusion).toBe('node_1');
    expect(plan.coveredNodeIds.sort()).toEqual(['node_1', 'node_2']);
  });

  it('merges matched nodes: adds aliases and a citation, no new node', () => {
    const plan = planMerge({
      ...base(),
      extractedNodes: [{ tempId: 'n1', kind: 'term', name: 'Nash Equilibrium', statement: 'restated', aliases: ['NE', 'equilibrium point'], locator: 'p1' }],
      identities: new Map([['n1', 'node_nash']]),
    });
    expect(plan.newNodes).toHaveLength(0);
    expect(plan.nodeUpdates).toEqual([{ nodeId: 'node_nash', aliases: ['equilibrium point'], sources: [{ sourceId: 'srcB', locator: 'p1' }] }]);
    expect(plan.coveredNodeIds).toEqual(['node_nash']);
  });

  it('re-ingesting the same content is a no-op apart from nothing', () => {
    const plan = planMerge({
      ...base(),
      sourceId: 'srcA',
      extractedNodes: [{ tempId: 'n1', kind: 'term', name: 'Nash equilibrium', statement: 's', aliases: ['NE'], locator: 'p3' }],
      extractedChains: [{ premises: ['node_br'], conclusion: 'n1', locator: 'p3' }],
      identities: new Map([['n1', 'node_nash']]),
    });
    expect(plan.newNodes).toHaveLength(0);
    expect(plan.nodeUpdates).toHaveLength(0);
    expect(plan.newChains).toHaveLength(0);
    expect(plan.chainUpdates).toHaveLength(0);
    expect(plan.droppedChainIds).toHaveLength(0);
  });

  it('adds a citation to an existing chain found again in a new source', () => {
    const plan = planMerge({
      ...base(),
      extractedNodes: [{ tempId: 'n1', kind: 'term', name: 'Nash equilibrium', statement: 's', aliases: [], locator: 'p9' }],
      extractedChains: [{ premises: ['node_br'], conclusion: 'n1', locator: 'p9' }],
      identities: new Map([['n1', 'node_nash']]),
    });
    expect(plan.newChains).toHaveLength(0);
    expect(plan.chainUpdates).toEqual([{ chainId: 'chain_1', sources: [{ sourceId: 'srcB', locator: 'p9' }] }]);
  });

  it('skips chains that reference unknown ids and self-premises', () => {
    const plan = planMerge({
      ...base(),
      extractedChains: [
        { premises: ['ghost'], conclusion: 'node_nash' },
        { premises: ['node_nash'], conclusion: 'node_nash' },
      ],
    });
    expect(plan.newChains).toHaveLength(0);
    expect(plan.skippedChains).toHaveLength(2);
  });

  it('simplification retires an existing longer chain when a shorter one arrives', () => {
    const plan = planMerge({
      ...base(),
      existingChains: [{ id: 'chain_long', premises: ['node_br', 'node_extra'], conclusion: 'node_nash', sources: [] }],
      existingNodes: new Map([
        [existingNode.id, existingNode],
        [existingBr.id, existingBr],
        ['node_extra', { ...existingBr, id: 'node_extra', name: 'extra' }],
      ]),
      extractedChains: [{ premises: ['node_br'], conclusion: 'node_nash', locator: 'p2' }],
    });
    expect(plan.newChains).toHaveLength(1);
    expect(plan.droppedChainIds).toEqual(['chain_long']);
  });
});
