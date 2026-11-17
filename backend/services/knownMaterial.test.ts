import { describe, expect, it } from 'vitest';
import { stageAsked } from '../llm/fakeTutor';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { openDatabase } from '../store/db';
import { getState, listEvidenceForNode } from '../store/evidence';
import { addCapabilities, createGoal } from '../store/goals';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { addCoverage, createSource, getSource } from '../store/sources';
import { listSessionEvents } from '../store/sessions';
import { previewPlan } from './budget';
import { recordEvidence } from './evidence';
import { startFreeSession } from './freeSession';
import { refreshGoalFields } from './knowledge';
import { checkFirstSources } from './knownMaterial';
import { markSourceKnown } from './library';
import { createProbe } from './probe';
import { respond } from './session';
import { SessionMaker } from './sessionMaker';
import type { SessionSnapshot } from './sessionView';
import { SessionWork } from './sessionWork';
import { trail } from './trails';

type Mark = { score: number; misconception?: string };

/** A tutor that grades from a queue (each with an optional misconception) and writes a plain card for any stage. */
function tutorFrom(marks: Mark[]) {
  const queue = [...marks];
  return (req: CompleteRequest<unknown>) => {
    const text = req.messages[0]?.content ?? '';
    const grading = /Grade the response/.test(text);
    const mark = grading ? (queue.shift() ?? { score: 0.9 }) : null;
    const grade = mark ? { score: mark.score, feedback: `Scored ${mark.score}.`, misconception: mark.misconception ?? null, confidentlyWrong: false, missingBackground: null } : null;
    const next = stageAsked(text, mark?.score ?? null);
    const cards: Record<string, unknown> = {
      predict: { stage: 'predict', prompt: 'What would you guess?' },
      explain: { stage: 'explain', markdown: 'Here is the idea.' },
      check: { stage: 'check', question: 'What does it say, in the lecture’s words?', answerKey: 'k', rubric: ['names it'] },
      derive: { stage: 'derive', prompt: 'Derive it.', answerKey: 'k', rubric: ['names it'] },
      connect: { stage: 'connect', prompt: 'Link it.' },
      compress: { stage: 'compress', prompt: 'Own words.' },
      use: { stage: 'use', task: 'Use it.', answerKey: 'k', rubric: ['names it'] },
      index: { stage: 'index', gist: 'Gist.', placement: 'Here.', question: 'What is it?', answerKey: 'k' },
      support: { stage: 'support', markdown: 'Worked example on the gap.' },
      reteach: { stage: 'reteach', markdown: 'Afresh.' },
    };
    return { grade, card: next ? cards[next] : null };
  };
}

/** Game theory with a lecture that covers best responses and Nash equilibrium, marked as known. */
function setup(marks: Mark[] = [], known = true) {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const id = (key: string) => ids.get(key) as string;
  for (const key of ['strategy', 'payoff', 'profile']) recordEvidence(db, { nodeId: id(key), kind: 'explain', score: 0.95, reasoning: 't' });
  const lecture = createSource(db, { kind: 'pdf', title: 'Lecture 3: Equilibrium', path: null, hash: 'l3' }, [{ text: 'Best responses and equilibrium.', locator: 'p2' }]);
  addCoverage(db, lecture.id, [id('bestResponse'), id('nash')]);
  if (known) markSourceKnown(db, lecture.id, true);
  const provider = new FakeProvider({ tutor: tutorFrom(marks) });
  const deps = { db, provider, work: new SessionWork() };
  return { db, id, lecture, provider, deps, maker: new SessionMaker() };
}

/** A session on one picked idea, past its orientation, at the first card of that idea. */
async function sessionOn(deps: ReturnType<typeof setup>['deps'], maker: SessionMaker, nodeId: string, goalId: string | null = null): Promise<SessionSnapshot> {
  const snap = await startFreeSession(deps, maker, { goalId, counted: goalId !== null, pick: [nodeId] });
  return respond(deps, snap.id, { answer: '' });
}

const lastTutorTask = (provider: FakeProvider) => provider.calls.filter((c) => c.role === 'tutor').at(-1)?.messages[0]?.content ?? '';
const stagesOf = (db: ReturnType<typeof openDatabase>, sessionId: string, nodeId: string) =>
  listSessionEvents(db, sessionId)
    .filter((e) => e.kind === 'card' && (e.payload as { nodeId?: string }).nodeId === nodeId)
    .map((e) => (e.payload as { stage: string }).stage);

describe('"I already know this material" (R8 E1)', () => {
  it('the flag alone writes no evidence and changes no depth', () => {
    const { db, id, lecture } = setup([], false);
    const before = listEvidenceForNode(db, id('bestResponse')).length;
    markSourceKnown(db, lecture.id, true);
    expect(getSource(db, lecture.id)?.known).toBe(true);
    expect(listEvidenceForNode(db, id('bestResponse'))).toHaveLength(before);
    expect(getState(db, id('bestResponse'))?.depth ?? 0).toBe(0);
    expect(checkFirstSources(db, id('bestResponse'), 2)).toEqual(['Lecture 3: Equilibrium']);
    // a first look is a short pass already, and an idea already at its aim needs no check
    expect(checkFirstSources(db, id('bestResponse'), 1)).toBeNull();
    expect(checkFirstSources(db, id('profile'), 2)).toBeNull();
  });

  it('strong: opens with a cold check in the material’s terms, then moves on without teaching', async () => {
    const { db, id, provider, deps, maker } = setup([{ score: 0.9 }]);
    let snap = await sessionOn(deps, maker, id('bestResponse'));
    expect(snap.card?.stage).toBe('check');
    expect(snap.current?.checking).toBe('You said you know this. Checking first.');
    const asked = lastTutorTask(provider);
    expect(asked).toContain('The learner says they already know this material');
    expect(asked).toContain('"Lecture 3: Equilibrium"');
    expect(asked).toContain('Do not teach first.');

    snap = await respond(deps, snap.id, { answer: 'The strategy with the highest payoff given what the others play.', confidence: 0.9 });
    // the idea counts through its evidence and the session moves on: nothing was explained
    expect(snap.phase).not.toBe('teach');
    expect(stagesOf(db, snap.id, id('bestResponse'))).toEqual(['check']);
    const evidence = listEvidenceForNode(db, id('bestResponse'));
    expect(evidence.at(-1)).toMatchObject({ kind: 'check', score: 0.9, context: { step: 'check', checkedFirst: true } });
    expect(getState(db, id('bestResponse'))?.depth).toBe(2);
    // the trail says why it opened with a check, and the idea does not open with one again
    expect(trail(db, snap.id).items.some((i) => i.type === 'check-first' && i.sources[0] === 'Lecture 3: Equilibrium')).toBe(true);
    expect(checkFirstSources(db, id('bestResponse'), 3)).toBeNull();
  });

  it('strong on an idea that goes deeper: one harder question at its aim instead of the loop', async () => {
    const { db, id, deps, maker } = setup([{ score: 0.9 }, { score: 0.9 }]);
    recordEvidence(db, { nodeId: id('bestResponse'), kind: 'explain', score: 0.95, reasoning: 't' });
    const goal = createGoal(db, 'Pass the exam');
    addCapabilities(db, goal.id, [{ statement: 'Can find equilibria', targets: [{ nodeId: id('nash'), depth: 3 }] }]);
    refreshGoalFields(db);
    let snap = await sessionOn(deps, maker, id('nash'), goal.id);
    expect(snap.current?.aim).toBe(3);
    expect(snap.card?.stage).toBe('check');
    snap = await respond(deps, snap.id, { answer: 'No one gains by moving alone.', confidence: 0.9 });
    expect(snap.card?.stage).toBe('derive');
    expect(snap.current?.checking).toBe('You knew the material, so one harder question.');
    snap = await respond(deps, snap.id, { answer: 'Each strategy is a best response to the others.', confidence: 0.9 });
    expect(snap.phase).not.toBe('teach');
    expect(stagesOf(db, snap.id, id('nash'))).toEqual(['check', 'derive']);
    expect(getState(db, id('nash'))?.depth).toBe(3);
  });

  it('weak: "I have no idea" goes back and teaches from scratch, from the explanation', async () => {
    const { db, id, deps, maker } = setup([{ score: 0 }]);
    let snap = await sessionOn(deps, maker, id('bestResponse'));
    snap = await respond(deps, snap.id, { answer: '' });
    expect(snap.card?.stage).toBe('explain');
    expect(snap.current?.checking).toBeNull();
    expect(listEvidenceForNode(db, id('bestResponse')).at(-1)?.context.checkedFirst).toBe(true);
  });

  it('weak: a clear misconception below the pass mark also teaches from scratch', async () => {
    const { id, deps, maker } = setup([{ score: 0.6, misconception: 'Thinks a best response must beat every strategy of the others.' }]);
    let snap = await sessionOn(deps, maker, id('bestResponse'));
    snap = await respond(deps, snap.id, { answer: 'It beats everything the others do.', confidence: 0.9 });
    expect(snap.card?.stage).toBe('explain');
  });

  it('in between: teaches only the gap, then checks again; strong then moves on', async () => {
    const { db, id, provider, deps, maker } = setup([{ score: 0.6 }, { score: 0.9 }]);
    let snap = await sessionOn(deps, maker, id('bestResponse'));
    snap = await respond(deps, snap.id, { answer: 'The best payoff, roughly.', confidence: 0.66 });
    expect(snap.card?.stage).toBe('support');
    expect(lastTutorTask(provider)).toContain('teaches only the gap your feedback names');
    snap = await respond(deps, snap.id, { answer: '' });
    // the check again, in a fresh version
    expect(snap.card?.stage).toBe('check');
    expect(lastTutorTask(provider)).toContain('Ask about the same step again from another side');
    snap = await respond(deps, snap.id, { answer: 'The highest payoff, holding the others fixed.', confidence: 0.9 });
    expect(snap.phase).not.toBe('teach');
    expect(stagesOf(db, snap.id, id('bestResponse'))).toEqual(['check', 'support', 'check']);
  });

  it('in between twice: taught from scratch after all', async () => {
    const { id, deps, maker } = setup([{ score: 0.6 }, { score: 0.6 }]);
    let snap = await sessionOn(deps, maker, id('bestResponse'));
    snap = await respond(deps, snap.id, { answer: 'roughly', confidence: 0.66 });
    snap = await respond(deps, snap.id, { answer: '' });
    snap = await respond(deps, snap.id, { answer: 'still roughly', confidence: 0.66 });
    expect(snap.card?.stage).toBe('explain');
  });

  it('a pass given as a guess is in between, not strong', async () => {
    const { id, deps, maker } = setup([{ score: 0.8 }]);
    let snap = await sessionOn(deps, maker, id('bestResponse'));
    snap = await respond(deps, snap.id, { answer: 'The highest payoff, I think.', confidence: 0.33 });
    expect(snap.card?.stage).toBe('support');
  });

  it('unticking restores teaching from scratch', async () => {
    const { lecture, db, id, deps, maker } = setup();
    markSourceKnown(db, lecture.id, false);
    const snap = await sessionOn(deps, maker, id('bestResponse'));
    expect(snap.card?.stage).toBe('predict');
    expect(snap.current?.checking).toBeNull();
  });

  it('the plan prices an unchecked known idea at its check, and the probe asks those ideas first', async () => {
    const { db, id, lecture, provider } = setup([], false);
    const goal = createGoal(db, { text: 'Pass the exam', budget: { mode: 'total', hours: 10 } });
    addCapabilities(db, goal.id, [{ statement: 'Can find equilibria', targets: [{ nodeId: id('nash'), depth: 2 }, { nodeId: id('dominant'), depth: 2 }, { nodeId: id('bestResponse'), depth: 2 }] }]);
    refreshGoalFields(db);
    const minutes = (nodeId: string) => previewPlan(db, goal.id, goal.budget)?.ideas.find((i) => i.nodeId === nodeId)?.minutes;
    const taught = minutes(id('nash')) ?? 0;
    markSourceKnown(db, lecture.id, true);
    expect(minutes(id('nash'))).toBeLessThan(taught);
    expect(minutes(id('nash'))).toBe(5);

    provider.script('prober', (req: CompleteRequest<unknown>) => {
      const list = (req.messages[0]?.content ?? '').split('## Candidates')[1] ?? '';
      const first = [...list.matchAll(/- \[(node_[a-z0-9_]+)\]/g)].map((m) => m[1] as string).slice(0, 2);
      return { questions: first.map((nodeId) => ({ nodeId, kind: 'check', question: 'Say what it means here, with an example.', answerKey: 'the key idea in plain words', rubric: ['names it'] })) };
    });
    await createProbe(db, provider, goal.id, 2);
    const asked = provider.calls.filter((c) => c.role === 'prober').at(-1)?.messages[0]?.content ?? '';
    const order = [...(asked.split('## Candidates')[1] ?? '').matchAll(/- \[(node_[a-z0-9_]+)\]/g)].map((m) => m[1]);
    expect(new Set(order.slice(0, 2))).toEqual(new Set([id('nash'), id('bestResponse')]));
    expect(asked).toContain('the learner says they already know it from "Lecture 3: Equilibrium"');
  });
});
