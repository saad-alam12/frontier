import { describe, expect, it } from 'vitest';
import { emptyFsrs } from './fsrs';
import { indexChains } from './graph';
import { computeFringe, doneSet } from './ownership';
import type { KnowledgeNode, NodeState } from './types';

const node = (id: string): KnowledgeNode => ({ id, kind: 'claim', name: id, statement: id, aliases: [], sources: [], status: 'verified' });
const state = (nodeId: string, depth: NodeState['depth']): NodeState => ({ nodeId, depth, targetDepth: 0, tier: 'archive', ownStatement: null, handle: null, fsrs: emptyFsrs(), firstSessionId: null });

describe('doneSet', () => {
  it('counts an idea the goal only asks to recognize as done once recognized, so what builds on it unlocks', () => {
    const index = indexChains([{ id: 'c1', premises: ['overview'], conclusion: 'next', sources: [] }]);
    const nodes = [node('overview'), node('next')];
    const states = new Map([['overview', state('overview', 1)]]);
    const owned = new Set<string>();
    const done = doneSet(owned, states, new Map([['overview', 1], ['next', 2]]));
    expect(done.has('overview')).toBe(true);
    expect(computeFringe({ nodes, index, owned: done }).has('next')).toBe(true);
    // asked deeper, recognizing is not enough
    expect(doneSet(owned, states, new Map([['overview', 2]])).has('overview')).toBe(false);
    // not recognized yet
    expect(doneSet(owned, new Map(), new Map([['overview', 1]])).has('overview')).toBe(false);
  });
});
