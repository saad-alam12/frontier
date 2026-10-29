import { describe, expect, it } from 'vitest';
import { depthSkew, remapNeed, skillStatus } from './goals';

describe('goal mechanics', () => {
  it('flags a compile with more than half its targets at depth 3 or more', () => {
    expect(depthSkew([1, 2, 2, 3, 4])).toEqual({ deepShare: 0.4, overTargeted: false });
    expect(depthSkew([3, 3, 4, 2]).overTargeted).toBe(true);
    expect(depthSkew([]).overTargeted).toBe(false);
  });

  it('derives a skill status from its targets', () => {
    expect(skillStatus(null, [{ depth: 2, currentDepth: 0 }])).toBe('not_started');
    expect(skillStatus(null, [{ depth: 2, currentDepth: 1 }, { depth: 3, currentDepth: 0 }])).toBe('learning');
    expect(skillStatus(null, [{ depth: 2, currentDepth: 2 }])).toBe('ready');
    expect(skillStatus('2026-10-27', [{ depth: 4, currentDepth: 1 }])).toBe('ready');
  });

  it('asks for a new map only when missing background matters for the time left', () => {
    expect(remapNeed([{ hours: 0.5 }], 10)).toBe('none'); // the tutor handles it idea by idea
    expect(remapNeed([{ hours: 2 }], 10)).toBe('fill'); // fits a quarter of the time: add it
    expect(remapNeed([{ hours: 2 }, { hours: 1.5 }], 10)).toBe('simplify'); // too much: a gentler map
    expect(remapNeed([{ hours: 30 }], null)).toBe('fill'); // no budget: the time covers it
  });
});
