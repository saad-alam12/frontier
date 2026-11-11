import { describe, expect, it } from 'vitest';
import { applyReview, emptyFsrs } from './fsrs';
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

  const credit = (weight: number) => ({ implicit: { fromNodeId: 'y', fromEvidenceId: 'e', hops: 1, weight } });
  const at = (day: number, minute = 0) => new Date(Date.UTC(2026, 0, 1 + day, 10, minute)).toISOString();

  it('one sitting is one review, and the prediction is left out of it', () => {
    const taught = [ev('check', 0.9, at(0, 5), { step: 'check' }), ev('explain', 0.9, at(0, 12), { step: 'compress' }), ev('use', 0.9, at(0, 20), { step: 'use' })];
    const wrongGuess = deriveState([ev('predict', 0.2, at(0, 0), { step: 'predict' }), ...taught]);
    const rightGuess = deriveState([ev('predict', 0.9, at(0, 0), { step: 'predict' }), ...taught]);
    expect(wrongGuess.fsrs).toEqual(rightGuess.fsrs); // a guess made before teaching says nothing about what was learned
    expect(wrongGuess.fsrs.reps).toBe(1);
    expect(wrongGuess.fsrs).toEqual(applyReview(emptyFsrs(), 0.9, new Date(at(0, 20))));
    expect(wrongGuess.fsrs.stability).toBeGreaterThan(5); // days, not hours
    // the same idea answered again the next day is a second review
    expect(deriveState([...taught, ev('practice', 0.9, at(1), { rung: 2 })]).fsrs.reps).toBe(2);
  });

  it('a sitting is scored by its graded answers together', () => {
    const struggled = deriveState([ev('check', 0.3, at(0, 5), { step: 'check' }), ev('check', 0.9, at(0, 15), { step: 'check' })]);
    expect(struggled.fsrs).toEqual(applyReview(emptyFsrs(), 0.6, new Date(at(0, 15))));
    expect(struggled.depth).toBe(2); // the pass still certifies the depth
  });

  it('a prediction alone is no review, but recognizing an idea in an index pass is', () => {
    expect(deriveState([ev('predict', 0.9, at(0), { step: 'predict' })]).fsrs.lastReview).toBeNull();
    const indexed = deriveState([ev('predict', 0.9, at(0), { step: 'index' })]);
    expect(indexed.fsrs.reps).toBe(1);
    expect(indexed.depth).toBe(1);
  });

  it('a lookup shows the answer, so it never counts as a review', () => {
    const base = [ev('explain', 0.9, at(0))];
    const looked = deriveState([...base, ev('lookup', 0.6, at(60)), ev('lookup', 0.6, at(61)), ev('lookup', 0.6, at(62))]);
    expect(looked.fsrs).toEqual(deriveState(base).fsrs);
  });

  it('implicit credit: a failed task gives none, and several tasks in one sitting give one light review', () => {
    const base = [ev('explain', 0.9, at(0))];
    const failedTask = deriveState([...base, ev('practice', 0, at(20), credit(0.5)), ev('practice', 0, at(20, 1), credit(0.5)), ev('practice', 0, at(20, 2), credit(0.5))]);
    expect(failedTask.fsrs).toEqual(deriveState(base).fsrs); // the premise was never asked
    const once = deriveState([...base, ev('practice', 0.9, at(20), credit(0.5))]);
    const thrice = deriveState([...base, ev('practice', 0.9, at(20), credit(0.5)), ev('practice', 0.9, at(20, 1), credit(0.25)), ev('practice', 0.9, at(20, 2), credit(0.5))]);
    expect(thrice.fsrs.stability).toBeCloseTo(once.fsrs.stability, 1); // the sitting ends two minutes later, nothing more
    expect(thrice.fsrs.reps).toBe(once.fsrs.reps);
    // a direct answer in the same sitting counts instead of the credit
    const direct = deriveState([...base, ev('practice', 0.9, at(20), credit(0.5)), ev('practice', 0.8, at(20, 5), { rung: 2 })]);
    expect(direct.fsrs).toEqual(applyReview(deriveState(base).fsrs, 0.8, new Date(at(20, 5))));
  });

  it('a partial failure hits a known idea half as hard as a clear one', () => {
    const base = deriveState([ev('explain', 0.9, at(0))]).fsrs;
    const partial = deriveState([ev('explain', 0.9, at(0)), ev('practice', 0.55, at(20), { rung: 2 })]).fsrs;
    const clear = deriveState([ev('explain', 0.9, at(0)), ev('practice', 0.1, at(20), { rung: 2 })]).fsrs;
    expect(clear.stability).toBeLessThan(partial.stability);
    expect(partial.stability).toBeLessThan(base.stability);
  });

  describe('failing an idea the learner knew', () => {
    const learned = [ev('check', 0.9, at(0), { step: 'check' }), ev('explain', 0.9, at(0, 10), { step: 'compress' })];
    const fail = (day: number, minute = 0) => ev('practice', 0.1, at(day, minute), { rung: 2 });

    it('one clear failure lowers only the freshness', () => {
      const s = deriveState([...learned, fail(10)]);
      expect(s.depth).toBe(2);
      expect(s.fsrs.stability).toBeLessThan(deriveState(learned).fsrs.stability);
    });

    it('clear failures in two sittings on different days drop it one level', () => {
      expect(deriveState([...learned, fail(10), fail(12)]).depth).toBe(1);
    });

    it('two failures on the same day are one bad day', () => {
      expect(deriveState([...learned, fail(10), fail(10, 30)]).depth).toBe(2); // one sitting
      expect(deriveState([...learned, fail(10), ev('practice', 0.1, new Date(Date.UTC(2026, 0, 11, 16)).toISOString(), { rung: 2 })]).depth).toBe(2); // two sittings, six hours apart
    });

    it('a pass in between starts the count again, and a later pass earns the depth back', () => {
      expect(deriveState([...learned, fail(10), ev('practice', 0.8, at(12), { rung: 1 }), fail(14)]).depth).toBe(2);
      expect(deriveState([...learned, fail(10), fail(12), ev('check', 0.9, at(13), { step: 'check' })]).depth).toBe(2);
    });

    it('needs two more failures to drop again', () => {
      const deep = [...learned, ev('use', 0.9, at(1), { step: 'use' })]; // depth 4
      expect(deriveState([...deep, fail(10), fail(12), fail(14)]).depth).toBe(3);
      expect(deriveState([...deep, fail(10), fail(12), fail(14), fail(16)]).depth).toBe(2);
    });
  });
});
