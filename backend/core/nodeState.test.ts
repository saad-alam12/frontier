import { describe, expect, it } from 'vitest';
import { certifiedDepth, deriveState } from './nodeState';
import type { Evidence } from './types';

let n = 0;
function ev(kind: Evidence['kind'], score: number, at: string, context: Evidence['context'] = {}): Evidence {
  n += 1;
  return { id: `e${n}`, nodeId: 'x', at, kind, score, reasoning: '', effort: null, confidence: null, context, sessionId: n % 2 ? 's1' : null };
}

describe('deriveState', () => {
  it('starts at depth 0 with no evidence', () => {
    const s = deriveState([]);
    expect(s.depth).toBe(0);
    expect(s.fsrs.lastReview).toBeNull();
  });

  it('certifies depth by evidence kind and rung', () => {
    expect(certifiedDepth('lookup', {})).toBe(1);
    expect(certifiedDepth('explain', {})).toBe(2);
    expect(certifiedDepth('derive', {})).toBe(3);
    expect(certifiedDepth('use', {})).toBe(4);
    expect(certifiedDepth('practice', { rung: 1 })).toBe(2);
    expect(certifiedDepth('practice', { rung: 3 })).toBe(4);
    expect(certifiedDepth('practice', { rung: 4 })).toBe(5);
    expect(certifiedDepth('practice', { rung: 4, implicit: { fromNodeId: 'y', fromEvidenceId: 'e', hops: 1, weight: 0.5 } })).toBe(0);
  });

  it('takes the highest passing level and ignores failures for depth', () => {
    const s = deriveState([ev('check', 0.9, '2026-01-01T00:00:00Z'), ev('derive', 0.3, '2026-01-02T00:00:00Z'), ev('use', 0.8, '2026-01-03T00:00:00Z')]);
    expect(s.depth).toBe(4);
    expect(s.fsrs.reps).toBe(3);
    expect(s.firstSessionId).toBe('s1');
  });

  it('is order independent', () => {
    const a = ev('explain', 0.9, '2026-01-01T00:00:00Z');
    const b = ev('check', 0.5, '2026-01-05T00:00:00Z');
    const c = ev('derive', 0.9, '2026-01-09T00:00:00Z');
    expect(deriveState([c, a, b])).toEqual(deriveState([a, b, c]));
  });

  it('implicit credit updates FSRS with its weight but not depth', () => {
    const base = deriveState([ev('explain', 0.9, '2026-01-01T00:00:00Z')]);
    const withCredit = deriveState([
      ev('explain', 0.9, '2026-01-01T00:00:00Z'),
      ev('use', 0.9, '2026-01-10T00:00:00Z', { implicit: { fromNodeId: 'y', fromEvidenceId: 'e', hops: 1, weight: 0.5 } }),
    ]);
    expect(withCredit.depth).toBe(2);
    expect(withCredit.fsrs.stability).toBeGreaterThan(base.fsrs.stability);
  });
});
