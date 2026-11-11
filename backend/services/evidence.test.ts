import { describe, expect, it } from 'vitest';
import { openDatabase } from '../store/db';
import { getState, listEvidenceForNode, upsertState } from '../store/evidence';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { getSetting, setSetting } from '../store/settingsTable';
import { recordEvidence } from './evidence';
import { STATE_RULES, upgradeDerivedStates } from './knowledge';

function world() {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const id = (key: string) => ids.get(key) as string;
  return { db, id };
}

describe('implicit credit', () => {
  it('a passed task credits its premises; a failed one writes nothing about them', () => {
    const { db, id } = world();
    const failed = recordEvidence(db, { nodeId: id('nash'), kind: 'practice', score: 0, reasoning: 'No idea', context: { rung: 2 } });
    expect(failed.implicit).toEqual([]);
    expect(listEvidenceForNode(db, id('bestResponse'))).toEqual([]);
    const passed = recordEvidence(db, { nodeId: id('nash'), kind: 'practice', score: 0.9, reasoning: 'Right', context: { rung: 2 } });
    expect(passed.implicit.map((e) => e.nodeId).sort()).toEqual([id('bestResponse'), id('payoff'), id('profile'), id('strategy')].sort());
  });
});

describe('stored states follow the rules', () => {
  it('derives every state again, once, when the rules changed', () => {
    const { db, id } = world();
    recordEvidence(db, { nodeId: id('nash'), kind: 'check', score: 0.9, reasoning: '', at: '2026-01-01T10:00:00.000Z', context: { step: 'check' } });
    const right = getState(db, id('nash'));
    if (!right) throw new Error('no state');
    // a state as an older version left it
    upsertState(db, { ...right, depth: 0, fsrs: { ...right.fsrs, stability: 0.2 } });
    setSetting(db, 'states.rules', '1');
    upgradeDerivedStates(db);
    expect(getState(db, id('nash'))).toMatchObject({ depth: right.depth, fsrs: right.fsrs });
    expect(getSetting(db, 'states.rules')).toBe(String(STATE_RULES));
    // the second time it does nothing
    upsertState(db, { ...right, depth: 0 });
    upgradeDerivedStates(db);
    expect(getState(db, id('nash'))?.depth).toBe(0);
  });
});
