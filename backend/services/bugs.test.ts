import { describe, expect, it } from 'vitest';
import { hasEnded } from '../core/bugs';
import { openDatabase } from '../store/db';
import { listBugsForNode } from '../store/bugs';
import { listEvidenceForNode } from '../store/evidence';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { afterAnswer } from './bugs';
import { recordEvidence } from './evidence';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-11-01T09:00:00Z');
const at = (hours: number) => new Date(T0 + hours * HOUR).toISOString();

function setup() {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const nash = ids.get('nash') as string;
  const answer = (hours: number, score: number, misconception: string | null = null, kind: 'explain' | 'practice' | 'predict' = 'explain') => {
    recordEvidence(db, { nodeId: nash, kind, score, reasoning: 'r', at: at(hours), context: kind === 'predict' ? { step: 'predict' } : {} });
    afterAnswer(db, nash, misconception, at(hours));
  };
  return { db, ids, nash, answer, open: () => listBugsForNode(db, nash).map((b) => b.description) };
}

const WRONG = 'Thinks an equilibrium is the best outcome for both players.';

describe('misconceptions', () => {
  it('puts a misconception on record once, however often it is seen', () => {
    const { db, nash, answer, open } = setup();
    answer(0, 0.3, WRONG);
    answer(1, 0.4, WRONG.toUpperCase());
    expect(open()).toEqual([WRONG]);
    expect(listBugsForNode(db, nash)[0]).toMatchObject({ firstSeen: at(0), lastSeen: at(1) });
    answer(2, 0.5, 'Confuses a best response with a dominant strategy.');
    expect(open()).toHaveLength(2);
  });

  it('ends after two clean answers, one of them at least half a day later', () => {
    const { db, nash, answer, open } = setup();
    answer(0, 0.3, WRONG);
    // corrected, then right twice in the same sitting: still fresh from the correction
    answer(0.2, 0.9);
    answer(0.4, 0.9);
    expect(open()).toEqual([WRONG]);
    // right again the next day: it held
    answer(26, 0.85, null, 'practice');
    expect(open()).toEqual([]);
    expect(listBugsForNode(db, nash, true)[0]?.resolvedAt).toBe(at(26));
  });

  it('does not end on one clean answer, a failed one, a prediction or credit from another idea', () => {
    const { db, ids, nash, answer, open } = setup();
    answer(0, 0.3, WRONG);
    answer(24, 0.9);
    expect(open()).toEqual([WRONG]);
    answer(48, 0.5); // wrong again, though without the misconception being named
    answer(49, 0.9, null, 'predict');
    // a passed task on an idea built on this one gives credit, not an answer about it
    recordEvidence(db, { nodeId: ids.get('nashMutualBr') as string, kind: 'use', score: 0.95, reasoning: 'r', at: at(50) });
    afterAnswer(db, nash, null, at(50));
    expect(listEvidenceForNode(db, nash).some((e) => e.context.implicit)).toBe(true);
    expect(open()).toEqual([WRONG]);
    answer(72, 0.9);
    expect(open()).toEqual([]);
  });

  it('comes back when it is seen again, and then needs clean answers afresh', () => {
    const { answer, open } = setup();
    answer(0, 0.3, WRONG);
    answer(1, 0.9);
    answer(30, 0.9);
    expect(open()).toEqual([]);
    answer(60, 0.4, WRONG);
    expect(open()).toEqual([WRONG]);
    answer(61, 0.9);
    expect(open()).toEqual([WRONG]);
    answer(90, 0.9);
    expect(open()).toEqual([]);
  });

  it('counts only answers after it was last seen', () => {
    const evidence = [0, 20, 40].map((h, i) => ({ id: `e${i}`, nodeId: 'n', kind: 'explain' as const, score: 0.9, reasoning: '', confidence: null, effort: null, context: {}, sessionId: null, at: at(h) }));
    expect(hasEnded({ lastSeen: at(-1) }, evidence)).toBe(true);
    expect(hasEnded({ lastSeen: at(30) }, evidence)).toBe(false); // one answer since
    expect(hasEnded({ lastSeen: at(45) }, evidence)).toBe(false);
  });
});
