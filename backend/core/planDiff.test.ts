import { describe, expect, it } from 'vitest';
import { planDiff } from './planDiff';

describe('plan diff of an addition', () => {
  it('names what joins, what the time cannot hold, and what makes room', () => {
    const before = [
      { nodeId: 'a', plannedDepth: 3 },
      { nodeId: 'b', plannedDepth: 2 },
      { nodeId: 'c', plannedDepth: 1 },
      { nodeId: 'd', plannedDepth: 2 },
      { nodeId: 'e', plannedDepth: 0 },
      { nodeId: 'f', plannedDepth: 2 },
    ];
    const after = [
      { nodeId: 'a', plannedDepth: 2 }, // derived becomes explained
      { nodeId: 'b', plannedDepth: 1 }, // becomes an overview
      { nodeId: 'c', plannedDepth: 0 }, // left out
      { nodeId: 'd', plannedDepth: 2 }, // unchanged
      { nodeId: 'e', plannedDepth: 2 }, // left out before, back in for the request
      { nodeId: 'f', plannedDepth: 2 },
      { nodeId: 'new1', plannedDepth: 2 },
      { nodeId: 'new2', plannedDepth: 1 },
      { nodeId: 'new3', plannedDepth: 0 }, // the time cannot hold it
    ];
    expect(planDiff(before, after)).toEqual({
      joined: [
        { nodeId: 'e', plannedDepth: 2 },
        { nodeId: 'new1', plannedDepth: 2 },
        { nodeId: 'new2', plannedDepth: 1 },
      ],
      missed: ['new3'],
      overview: ['b'],
      leftOut: ['c'],
      shallower: ['a'],
    });
  });

  it('changes nothing elsewhere when the time has room', () => {
    const before = [{ nodeId: 'a', plannedDepth: 2 }];
    const diff = planDiff(before, [...before, { nodeId: 'n', plannedDepth: 3 }]);
    expect(diff).toEqual({ joined: [{ nodeId: 'n', plannedDepth: 3 }], missed: [], overview: [], leftOut: [], shallower: [] });
  });
});
