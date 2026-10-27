import { describe, expect, it } from 'vitest';
import { depthSkew, skillStatus } from './goals';

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
});
