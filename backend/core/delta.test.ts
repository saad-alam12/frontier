import { describe, expect, it } from 'vitest';
import { classifyDelta } from './delta';
import { emptyFsrs } from './fsrs';
import type { Depth, NodeState } from './types';

const state = (nodeId: string, depth: Depth): NodeState => ({ nodeId, depth, targetDepth: 0, tier: 'archive', ownStatement: null, handle: null, fsrs: emptyFsrs(), firstSessionId: null });

describe('classifyDelta', () => {
  it('classifies every node into one bucket', () => {
    const view = classifyDelta({
      nodeIds: ['known', 'deeper', 'fringe', 'beyond', 'conflict'],
      states: new Map([
        ['known', state('known', 3)],
        ['deeper', state('deeper', 2)],
      ]),
      owned: new Set(['known', 'deeper', 'conflict']),
      fringe: new Set(['fringe']),
      targetDepths: new Map([
        ['known', 3],
        ['deeper', 4],
      ]),
      conflicts: new Set(['conflict']),
    });
    expect(view.classes.get('known')).toBe('known');
    expect(view.classes.get('deeper')).toBe('deeper');
    expect(view.classes.get('fringe')).toBe('new-fringe');
    expect(view.classes.get('beyond')).toBe('new-beyond');
    expect(view.classes.get('conflict')).toBe('conflict');
    expect(view.counts).toEqual({ known: 1, deeper: 1, 'new-fringe': 1, 'new-beyond': 1, conflict: 1 });
  });
});
