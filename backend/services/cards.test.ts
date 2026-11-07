import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IdeaFinished } from '../core/cards';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { countAutoCards, createCard, getCard, listCards, reviewsByCard, saveGoalCardSettings, setCardsWithoutGoal } from '../store/cards';
import { openDatabase } from '../store/db';
import { addCapabilities, createGoal } from '../store/goals';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { createSession, endSession } from '../store/sessions';
import { cardQueue, cardSummary, creditRecalledCards, listCardViews, queueIdeaCards, reviewCard, saveCard, settleCardWriting, suspendCard, writeCardsForIdea } from './cards';
import { eraseFromMap, previewErase } from './erase';

function setup() {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const id = (key: string) => ids.get(key) as string;
  const goal = createGoal(db, 'Pass the game theory exam');
  addCapabilities(db, goal.id, [{ statement: 'Can find equilibria', targets: [{ nodeId: id('nash'), depth: 2 }, { nodeId: id('bestResponse'), depth: 2 }] }]);
  const session = createSession(db, goal.id, {});
  endSession(db, session.id, 'done');
  const finished = (goalId: string | null, nodeId: string): IdeaFinished => ({
    sessionId: session.id,
    goalId,
    nodeId,
    taught: ['A profile where nobody gains by deviating alone.'],
    answers: [{ question: 'When is a profile stable?', answer: 'when no one wants to switch', score: 0.8 }],
  });
  return { db, id, goal, finished };
}

const noon = (day: number, minutes = 0) => new Date(2026, 2, day, 12, minutes);
const writer = (cards: { front: string; back: string }[]) => new FakeProvider({ cardWriter: [{ cards }] });

describe('flashcards', () => {
  it('saves a card on its ideas and the goal that holds them; an edit keeps its schedule', () => {
    const { db, id, goal } = setup();
    const card = saveCard(db, { front: 'Define a Nash equilibrium', back: 'A profile where no player gains by deviating alone.', nodeIds: [id('nash')] });
    expect(card.goalId).toBe(goal.id); // the one active goal that holds its idea
    expect(card.origin).toBe('hand');
    expect(card.phase).toBe('new');
    reviewCard(db, card.id, 4, noon(2));
    const edited = saveCard(db, { id: card.id, front: 'Define a Nash equilibrium exactly', back: card.back, nodeIds: [id('nash'), id('bestResponse')] });
    expect(edited.front).toBe('Define a Nash equilibrium exactly');
    expect(edited.ideas.map((i) => i.id)).toEqual([id('nash'), id('bestResponse')]);
    expect(edited.phase).toBe('review');
    expect(edited.reps).toBe(1);
    expect(() => saveCard(db, { front: 'No idea at all', back: 'x', nodeIds: [] })).toThrow();
  });

  it('lets in at most 20 new cards a day across goals; cards a session recalled do not use up the day', () => {
    const { db, id } = setup();
    const cards = Array.from({ length: 25 }, (_, i) => saveCard(db, { front: `Fact number ${i}`, back: String(i), nodeIds: [id('nash')], goalId: null }));
    expect(cardQueue(db, null, noon(2)).left).toEqual({ due: 0, new: 20 });
    expect(cardSummary(db, null, noon(2)).toReview).toBe(20);
    for (const c of cards.slice(0, 5)) reviewCard(db, c.id, 4, noon(2, 1));
    // five introduced and out for days: fifteen new left today
    expect(cardQueue(db, null, noon(2, 2)).left).toEqual({ due: 0, new: 15 });
    creditRecalledCards(db, [cards[20]?.id ?? ''], { source: 'session', sessionId: null }, noon(2, 3));
    const q = cardQueue(db, null, noon(2, 4));
    expect(q.left.new).toBe(15);
    expect(q.reviewedToday).toBe(5);
    // the next day the limit starts again
    expect(cardQueue(db, null, noon(3)).left.new).toBe(19);
  });

  it('a missed card comes back in the same sitting; suspended cards never come', () => {
    const { db, id } = setup();
    const a = saveCard(db, { front: 'What does BR stand for?', back: 'Best response', nodeIds: [id('bestResponse')] });
    const b = saveCard(db, { front: 'What does NE stand for?', back: 'Nash equilibrium', nodeIds: [id('nash')] });
    suspendCard(db, b.id, true);
    expect(cardQueue(db, null, noon(2)).card?.id).toBe(a.id);
    reviewCard(db, a.id, 1, noon(2));
    const after = cardQueue(db, null, noon(2, 0));
    // nothing else is due, so the missed card comes again at once rather than in a minute
    expect(after.card?.id).toBe(a.id);
    expect(after.card?.next[1] && new Date(after.card.next[1]).getTime()).toBeLessThan(noon(2, 15).getTime());
    expect(() => reviewCard(db, b.id, 3, noon(2))).toThrow(/suspended/);
    reviewCard(db, a.id, 4, noon(2, 2));
    const done = cardQueue(db, null, noon(2, 3));
    expect(done.card).toBeNull();
    expect(done.nextDue).not.toBeNull();
    expect(done.total).toBe(2);
  });

  it('filters by goal, idea and words', () => {
    const { db, id, goal } = setup();
    saveCard(db, { front: 'Define a Nash equilibrium', back: 'No profitable deviation.', nodeIds: [id('nash')] });
    saveCard(db, { front: 'Who proved existence in mixed strategies?', back: 'John Nash, 1950', nodeIds: [id('mixed')], goalId: null });
    expect(listCardViews(db, { goalId: goal.id }).cards).toHaveLength(1);
    expect(listCardViews(db, { nodeId: id('mixed') }).cards[0]?.back).toBe('John Nash, 1950');
    expect(listCardViews(db, { query: 'nash 1950' }).cards).toHaveLength(1);
    expect(listCardViews(db).ideas.map((i) => i.count)).toEqual([1, 1]);
  });
});

describe('automatic cards', () => {
  it('writes the cards for a finished idea, tagged with it, in the goal', async () => {
    const { db, id, goal, finished } = setup();
    const provider = writer([{ front: 'Define a Nash equilibrium', back: 'A profile where no player gains by changing alone.' }]);
    const cards = await writeCardsForIdea({ db, provider }, finished(goal.id, id('nash')));
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ origin: 'auto', goalId: goal.id, ideas: [{ id: id('nash'), name: 'Nash equilibrium' }] });
    const text = provider.calls[0]?.messages[0]?.content ?? '';
    expect(text).toContain('nobody gains by deviating alone');
    expect(text).toContain('when no one wants to switch');
  });

  it('respects the goal switch, asks only for the room left, and never stores past the maximum', async () => {
    const { db, id, goal, finished } = setup();
    saveGoalCardSettings(db, goal.id, { enabled: false, max: 40 });
    const off = new FakeProvider();
    expect(await writeCardsForIdea({ db, provider: off }, finished(goal.id, id('nash')))).toEqual([]);
    expect(off.calls).toHaveLength(0);

    saveGoalCardSettings(db, goal.id, { enabled: true, max: 4 });
    for (const front of ['One', 'Two']) createCard(db, { front: `Earlier card ${front}`, back: 'x', nodeIds: [id('strategy')], goalId: goal.id, origin: 'auto' });
    // two ideas finish close together: both are asked while the room is still 2, and both answer with 2
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let n = 0;
    const provider = new FakeProvider({
      cardWriter: async (req: CompleteRequest<unknown>) => {
        expect(req.messages[0]?.content).toContain('Write between 0 and 2 cards');
        n += 1;
        const mine = n;
        await gate;
        return { cards: [{ front: `Fact ${mine}a`, back: 'a' }, { front: `Fact ${mine}b`, back: 'b' }] };
      },
    });
    const both = Promise.all([writeCardsForIdea({ db, provider }, finished(goal.id, id('nash'))), writeCardsForIdea({ db, provider }, finished(goal.id, id('bestResponse')))]);
    await new Promise((r) => setTimeout(r, 0));
    release();
    const [first, second] = await both;
    expect((first?.length ?? 0) + (second?.length ?? 0)).toBe(2);
    expect(countAutoCards(db, goal.id)).toBe(4);
    // full: no call at all
    const after = new FakeProvider();
    expect(await writeCardsForIdea({ db, provider: after }, finished(goal.id, id('mixed')))).toEqual([]);
    expect(after.calls).toHaveLength(0);
  });

  it('drops a card that asks what an existing card already asks', async () => {
    const { db, id, goal, finished } = setup();
    saveCard(db, { front: 'Define a Nash equilibrium', back: 'x', nodeIds: [id('nash')] });
    const cards = await writeCardsForIdea({ db, provider: writer([{ front: 'define a **Nash equilibrium**', back: 'y' }, { front: 'Who introduced the Nash equilibrium?', back: 'John Nash' }]) }, finished(goal.id, id('nash')));
    expect(cards.map((c) => c.front)).toEqual(['Who introduced the Nash equilibrium?']);
  });

  it('without a goal, the Settings switch decides, and the cards have no goal', async () => {
    const { db, id, finished } = setup();
    setCardsWithoutGoal(db, false);
    expect(await writeCardsForIdea({ db, provider: new FakeProvider() }, finished(null, id('nash')))).toEqual([]);
    setCardsWithoutGoal(db, true);
    const cards = await writeCardsForIdea({ db, provider: writer([{ front: 'Define a Nash equilibrium', back: 'x' }]) }, finished(null, id('nash')));
    expect(cards[0]?.goalId).toBeNull();
  });

  it('zero cards is a normal answer; a failure in the background stores nothing and is reported', async () => {
    const { db, id, goal, finished } = setup();
    expect(await writeCardsForIdea({ db, provider: writer([]) }, finished(goal.id, id('nash')))).toEqual([]);
    const errors: string[] = [];
    queueIdeaCards({ db, provider: new FakeProvider({ cardWriter: [{ cards: 'nope' }] }), onError: (m) => errors.push(m) }, finished(goal.id, id('nash')));
    await settleCardWriting();
    expect(errors).toHaveLength(1);
    expect(listCards(db)).toHaveLength(0);
  });
});

describe('recall in use', () => {
  it('a recalled card gets one Good review from a session, at most once in twelve hours; suspended cards are skipped', () => {
    const { db, id } = setup();
    const a = saveCard(db, { front: 'Define a Nash equilibrium', back: 'x', nodeIds: [id('nash')] });
    const b = saveCard(db, { front: 'Define a best response', back: 'y', nodeIds: [id('bestResponse')] });
    suspendCard(db, b.id, true);
    expect(creditRecalledCards(db, [a.id, a.id, b.id, 'card_missing'], { source: 'session', sessionId: null }, noon(2))).toEqual([a.id]);
    expect(reviewsByCard(db).get(a.id)).toEqual([{ at: noon(2).toISOString(), rating: 3, source: 'session' }]);
    expect(creditRecalledCards(db, [a.id], { source: 'practice', sessionId: null }, noon(2, 60))).toEqual([]);
    expect(creditRecalledCards(db, [a.id], { source: 'practice', sessionId: null }, noon(3))).toEqual([a.id]);
  });
});

describe('erasing ideas', () => {
  it('removes an erased idea from its cards and deletes cards left with no idea', () => {
    const { db, id } = setup();
    const only = saveCard(db, { front: 'Define a Nash equilibrium', back: 'x', nodeIds: [id('nash')] });
    const shared = saveCard(db, { front: 'Nash equilibrium as best responses', back: 'y', nodeIds: [id('nash'), id('bestResponse')] });
    const request = { scope: 'ideas' as const, ids: [id('nash')] };
    expect(previewErase(db, request).cards).toBe(1);
    eraseFromMap({ db, sourcesDir: mkdtempSync(join(tmpdir(), 'frontier-cards-')) }, request);
    expect(getCard(db, only.id)).toBeUndefined();
    expect(getCard(db, shared.id)?.nodeIds).toEqual([id('bestResponse')]);
  });
});
