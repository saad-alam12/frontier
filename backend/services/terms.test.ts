import { describe, expect, it } from 'vitest';
import { openDatabase } from '../store/db';
import { addCapabilities, createGoal } from '../store/goals';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { createSource } from '../store/sources';
import { applyMergePlan } from '../store/worldWrites';
import { saveCard, suspendCard } from './cards';
import { recordEvidence, setOwnStatement } from './evidence';
import { refreshGoalFields } from './knowledge';
import { saveTermsPreference, termPeek, termsIndex, termsPreference } from './terms';

function setup() {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const id = (key: string) => ids.get(key) as string;
  return { db, id };
}

describe('hover definitions: the index and the popover (R8 E2)', () => {
  it('holds the ideas learned or on a flashcard, by every name, and says when it has not changed', () => {
    const { db, id } = setup();
    expect(termsIndex(db)?.terms).toEqual([]);
    recordEvidence(db, { nodeId: id('nash'), kind: 'explain', score: 0.9, reasoning: 't' });
    saveCard(db, { front: 'What is a best response?', back: 'The best reply to what the others play.', nodeIds: [id('bestResponse')], goalId: null });
    const suspended = saveCard(db, { front: 'Define a strictly dominated strategy', back: 'Beaten by another whatever the others do.', nodeIds: [id('dominated')], goalId: null });
    suspendCard(db, suspended.id, true);
    const view = termsIndex(db);
    expect(view?.terms.map((t) => t.id).sort()).toEqual([id('bestResponse'), id('nash')].sort());
    expect(view?.terms.find((t) => t.id === id('nash'))?.names).toEqual(['Nash equilibrium']);
    // the window's copy still holds: nothing is sent again
    expect(termsIndex(db, view?.version)).toBeNull();
    recordEvidence(db, { nodeId: id('strategy'), kind: 'explain', score: 0.9, reasoning: 't' });
    expect(termsIndex(db, view?.version)?.terms).toHaveLength(3);
  });

  it('shows the learner’s own words first, where they stand, what it connects to, where it is used and its cards', () => {
    const { db, id } = setup();
    const lecture = createSource(db, { kind: 'pdf', title: 'Lecture 3', path: null, hash: 'l3' }, [{ text: 'Equilibrium.', locator: 'p6' }]);
    applyMergePlan(db, { newNodes: [], nodeUpdates: [{ nodeId: id('nash'), aliases: [], sources: [{ sourceId: lecture.id, locator: 'p6' }] }], newChains: [], chainUpdates: [], droppedChainIds: [], coveredNodeIds: [], skippedChains: [], examples: [] });
    const goal = createGoal(db, 'Pass the exam');
    addCapabilities(db, goal.id, [{ statement: 'Can find equilibria', targets: [{ nodeId: id('nash'), depth: 2 }] }]);
    refreshGoalFields(db);
    recordEvidence(db, { nodeId: id('nash'), kind: 'explain', score: 0.9, reasoning: 't', at: '2026-11-12T10:00:00.000Z' });
    setOwnStatement(db, id('nash'), 'Nobody gains by moving alone.');
    saveCard(db, { front: 'State the Nash condition', back: 'No profitable deviation for any player.', nodeIds: [id('nash')], goalId: goal.id });

    const peek = termPeek(db, id('nash'));
    expect(peek).toMatchObject({ name: 'Nash equilibrium', definition: 'Nobody gains by moving alone.', ownWords: true, learned: { depth: 2, on: '2026-11-12T10:00:00.000Z' }, goals: ['Pass the exam'] });
    expect(peek.builtOn).toEqual(expect.arrayContaining(['Strategy profile', 'Best response']));
    expect(peek.leadsTo.length).toBeGreaterThan(0);
    expect(peek.sources).toContainEqual({ sourceId: lecture.id, title: 'Lecture 3', locator: 'p6' });
    expect(peek.cards.map((c) => c.front)).toEqual(['State the Nash condition']);

    // an idea only on a flashcard: its statement, and no standing
    saveCard(db, { front: 'What does IESDS stand for?', back: 'Iterated elimination of strictly dominated strategies.', nodeIds: [id('iesds')], goalId: null });
    expect(termPeek(db, id('iesds'))).toMatchObject({ ownWords: false, learned: null, cards: [{ front: 'What does IESDS stand for?' }] });
  });

  it('is on by default and can be turned off in Settings', () => {
    const { db } = setup();
    expect(termsPreference(db)).toEqual({ show: true });
    expect(saveTermsPreference(db, false)).toEqual({ show: false });
    expect(termsPreference(db)).toEqual({ show: false });
  });
});
