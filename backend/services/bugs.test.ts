import { describe, expect, it } from 'vitest';
import { hasEnded } from '../core/bugs';
import { openDatabase } from '../store/db';
import { listBugsForNode } from '../store/bugs';
import { listEvidenceForNode } from '../store/evidence';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { afterAnswer, dismissMisconception } from './bugs';
import { misconceptionsView } from './misconceptions';
import { addCapabilities, createGoal } from '../store/goals';
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

  it('recognises the same belief reworded, and opens an ended one again when it comes back', () => {
    const { db, nash, answer, open } = setup();
    answer(0, 0.3, WRONG);
    answer(1, 0.2, 'Believes the equilibrium outcome is the best one for both of the players.');
    expect(open()).toEqual([WRONG]);
    // two clean answers, one half a day later: it ends
    answer(2, 0.9);
    answer(20, 0.9);
    expect(open()).toEqual([]);
    // the same belief again, worded differently: the same record, open again
    answer(30, 0.2, 'Thinks an equilibrium means the best outcome for both players.');
    expect(open()).toEqual([WRONG]);
    expect(listBugsForNode(db, nash, true)).toHaveLength(1);
  });

  it('lists every misconception with how close it is to ending, and lets the learner set one aside', () => {
    const { db, ids, nash, answer } = setup();
    const goal = createGoal(db, { text: 'Pass the game theory exam' });
    addCapabilities(db, goal.id, [{ statement: 'Can find equilibria', targets: [{ nodeId: nash, depth: 2 }] }]);
    answer(0, 0.3, WRONG);
    answer(2, 0.9);
    recordEvidence(db, { nodeId: ids.get('dominant') as string, kind: 'explain', score: 0.3, reasoning: 'r', at: at(3) });
    afterAnswer(db, ids.get('dominant') as string, 'Thinks a dominant strategy needs the other player to cooperate.', at(3));
    const view = misconceptionsView(db);
    expect(view.map((m) => [m.idea, m.cleanSince, m.goalId])).toEqual([
      ['Strictly dominant strategy', 0, null],
      ['Nash equilibrium', 1, goal.id],
    ]);
    const first = view[0]?.id ?? '';
    dismissMisconception(db, first);
    expect(misconceptionsView(db).find((m) => m.id === first)?.endedAt).not.toBeNull();
    expect(() => dismissMisconception(db, first)).toThrow(/already ended/);
  });
});
