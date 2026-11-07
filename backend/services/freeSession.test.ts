import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { openDatabase } from '../store/db';
import { addCapabilities, createGoal } from '../store/goals';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { getState, listEvidenceForSession } from '../store/evidence';
import { getSession, listSessionEvents } from '../store/sessions';
import { logTime } from '../store/activity';
import { getNode, listChains } from '../store/world';
import { attributeTime, freeStudy, learnerSpeedNow, spentByGoal } from './budget';
import { tick } from './activity';
import { recordEvidence } from './evidence';
import { previewFree, startFreeSession } from './freeSession';
import { refreshGoalFields } from './knowledge';
import { abandonSession, respond, startSession } from './session';
import type { SessionSnapshot, SessionState } from './session';
import { SessionMaker } from './sessionMaker';
import { SessionWork } from './sessionWork';
import { statsView } from './stats';
import { listTrails } from './trails';

/** A tutor that writes a card for any stage and grades every answer 0.9; recall scores every idea. */
function tutor(req: CompleteRequest<unknown>) {
  const text = req.messages[0]?.content ?? '';
  if (req.submit.name === 'submit_recall') {
    const ids = [...text.matchAll(/- \[(node_[a-z0-9_]+)\]/g)].map((m) => m[1]);
    const closing = /add the closing summary/.test(text);
    return { recalled: ids.map((id) => ({ nodeId: id, score: 0.9, note: '' })), canDo: closing ? 'You can explain it.' : null, previewQuestion: closing ? 'What if?' : null };
  }
  const next = /roduce the \*\*(\w+)\*\* card/.exec(text)?.[1] ?? null;
  const grade = /Grade the response/.test(text) ? { score: 0.9, feedback: 'Good.', misconception: null, confidentlyWrong: false, missingBackground: null } : null;
  const cards: Record<string, unknown> = {
    predict: { stage: 'predict', prompt: 'What would you guess?' },
    explain: { stage: 'explain', markdown: 'Here is the idea.' },
    check: { stage: 'check', question: 'Check?', answerKey: 'k', rubric: ['names it'] },
    derive: { stage: 'derive', prompt: 'Derive it.', answerKey: 'k', rubric: ['names it'] },
    connect: { stage: 'connect', prompt: 'Link it.' },
    compress: { stage: 'compress', prompt: 'Own words.' },
    use: { stage: 'use', task: 'Use it.', answerKey: 'k', rubric: ['names it'] },
    index: { stage: 'index', gist: 'Gist.', placement: 'Here.', question: 'What is it?', answerKey: 'k' },
  };
  return { grade, card: next ? cards[next] : null };
}

function planner(req: CompleteRequest<unknown>) {
  const ids = [...(req.messages[0]?.content ?? '').split('## Candidates')[1]?.matchAll(/- \[(node_[a-z0-9_]+)\]/g) ?? []].map((m) => m[1] as string);
  return { title: 'The goal’s own session', orientation: 'Planned from the goal, as usual.', steps: ids.slice(0, 2).map((nodeId) => ({ nodeId, why: 'needed for the goal' })) };
}

function setup(script: ConstructorParameters<typeof FakeProvider>[0] = {}) {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const id = (key: string) => ids.get(key) as string;
  for (const key of ['strategy', 'payoff']) recordEvidence(db, { nodeId: id(key), kind: 'explain', score: 0.95, reasoning: 't' });
  const provider = new FakeProvider({ tutor, planner, ...script });
  const work = new SessionWork();
  const maker = new SessionMaker();
  return { db, id, provider, maker, deps: { db, provider, work } };
}

function gameTheoryGoal(db: ReturnType<typeof openDatabase>, id: (key: string) => string) {
  const goal = createGoal(db, 'Pass the game theory exam');
  addCapabilities(db, goal.id, [{ statement: 'Can find Nash equilibria', targets: [{ nodeId: id('nash'), depth: 3 }, { nodeId: id('profile'), depth: 1 }, { nodeId: id('bestResponse'), depth: 2 }] }]);
  refreshGoalFields(db);
  return goal;
}

/** Answer every card until the session closes, then finish it. */
async function teachToTheEnd(deps: ReturnType<typeof setup>['deps'], snap: SessionSnapshot): Promise<SessionSnapshot> {
  let s = await respond(deps, snap.id, { answer: '' });
  for (let i = 0; i < 40 && s.phase === 'teach'; i += 1) s = await respond(deps, s.id, { answer: 'my answer', confidence: 0.9 });
  expect(s.phase).toBe('close');
  s = await respond(deps, s.id, { answer: 'what I remember' });
  expect(s.phase).toBe('preview');
  return respond(deps, s.id, { answer: '' });
}

describe('choosing what to learn', () => {
  it('runs a session with no goal from start to end, framed by what was chosen', async () => {
    const { db, id, provider, maker, deps } = setup();
    let snap = await startFreeSession(deps, maker, { goalId: null, counted: true, pick: [id('bestResponse')] });
    expect(snap).toMatchObject({ phase: 'orient', goalId: null, goalTitle: 'Free study', free: { description: null, picked: ['Best response'], counted: false } });
    expect(getSession(db, snap.id)?.goalId).toBeNull(); // with no goal nothing is counted, whatever was asked
    expect(snap.plan.steps.map((s) => s.name)).toEqual(['Best response']);

    snap = await teachToTheEnd(deps, snap);
    expect(snap.status).toBe('done');
    expect(getState(db, id('bestResponse'))?.depth).toBeGreaterThanOrEqual(2);
    expect(listEvidenceForSession(db, snap.id).length).toBeGreaterThan(0);
    const first = provider.calls.find((c) => c.role === 'tutor')?.messages[0]?.content ?? '';
    expect(first).toContain('The learner chose to learn Best response now.');
    expect(first).toContain('Assessed by nothing');
    // no recall from a goal's last session, no planner and no practice at the end
    expect(provider.calls.map((c) => c.role)).not.toContain('planner');
    expect(provider.calls.map((c) => c.role)).not.toContain('problemGenerator');
  });

  it('warns about picked ideas whose premises are not yours, and adds them first when asked', () => {
    const { db, id, maker } = setup();
    const goal = gameTheoryGoal(db, id);
    let plan = previewFree(db, maker, { goalId: goal.id, counted: true, pick: [id('nash')] });
    expect(plan.background).toEqual([
      { ref: id('profile'), name: 'Strategy profile', isNew: false, neededBy: ['Nash equilibrium'], reason: null },
      { ref: id('bestResponse'), name: 'Best response', isNew: false, neededBy: ['Nash equilibrium'], reason: null },
    ]);
    expect(plan.ideas).toMatchObject([{ name: 'Nash equilibrium', aim: 3, state: 'beyond', addedFirst: false }]); // as deep as the goal asks

    plan = previewFree(db, maker, { goalId: goal.id, counted: true, pick: [id('nash')], addFirst: [id('profile')] });
    expect(plan.ideas.map((i) => [i.name, i.addedFirst])).toEqual([
      ['Strategy profile', true],
      ['Nash equilibrium', false],
    ]);
    expect(plan.ideas[0]?.why).toBe('Nash equilibrium builds on it, so it comes first.');
    expect(plan.background.map((b) => b.name)).toEqual(['Best response']);
    expect(plan.minutes).toBe(plan.ideas.reduce((s, i) => s + i.minutes, 0));
    // with no goal, an idea is learned to be owned
    expect(previewFree(db, maker, { goalId: null, counted: false, pick: [id('dominant')] }).ideas[0]?.aim).toBe(2);
  });

  it('turns a description into ideas: new ones join the map as unverified ideas cited to the session, and are taught', async () => {
    const proposal = {
      title: 'Attention, from scratch',
      summary: 'How a model weighs earlier words when it reads the next one.',
      level: 'intuition',
      ideas: [{ ref: 'n2', aim: 2, why: 'It is what you asked about.' }],
      newIdeas: [
        { tempId: 'n1', kind: 'term', name: 'Dot product', statement: 'Multiply two lists of numbers entry by entry and add the results.', premises: [] },
        { tempId: 'n2', kind: 'claim', name: 'Attention', statement: 'Each word scores every earlier word by a dot product and takes a weighted mix of them.', premises: ['n1'] },
      ],
      background: [{ ref: 'n1', reason: 'Attention scores are dot products.' }],
    };
    const { db, provider, maker, deps } = setup({ sessionPlanner: [{ ...proposal, ideas: [{ ref: 'node_missing', aim: 2, why: 'Not on the map.' }] }, proposal] });

    const made = await maker.make(deps, { description: 'How attention works in a transformer', goalId: null });
    expect(made.status).toBe('ready');
    const call = provider.calls.find((c) => c.role === 'sessionPlanner');
    expect(call?.messages[0]?.content).toContain('How attention works in a transformer');
    expect(call?.messages[0]?.content).toContain('Strategy'); // what the learner owns

    const plan = previewFree(db, maker, { goalId: null, counted: false, proposalId: made.id });
    expect(plan).toMatchObject({ title: 'Attention, from scratch', level: 'intuition', ideas: [{ ref: 'n2', name: 'Attention', state: 'new', aim: 2 }] });
    expect(plan.background).toEqual([{ ref: 'n1', name: 'Dot product', isNew: true, neededBy: ['Attention'], reason: 'Attention scores are dot products.' }]);

    let snap = await startFreeSession(deps, maker, { goalId: null, counted: false, proposalId: made.id, addFirst: ['n1'] });
    expect(maker.current()).toBeNull(); // the proposal is spent
    expect(snap.free?.description).toBe('How attention works in a transformer');
    const [dot, attention] = snap.plan.steps;
    expect([dot?.name, attention?.name]).toEqual(['Dot product', 'Attention']);
    expect(attention?.dependsOn).toEqual([dot?.nodeId]);
    for (const step of [dot, attention]) expect(getNode(db, step?.nodeId ?? '')).toMatchObject({ status: 'unverified', sources: [{ sourceId: snap.id }] });
    expect(listChains(db).some((c) => c.conclusion === attention?.nodeId && c.premises.includes(dot?.nodeId ?? ''))).toBe(true);

    snap = await respond(deps, snap.id, { answer: '' });
    expect(snap.current?.name).toBe('Dot product');
    const taught = provider.calls.filter((c) => c.role === 'tutor').at(-1)?.messages[0]?.content ?? '';
    expect(taught).toContain('Dot product');
    expect(taught).toContain('The learner asked for this session: "How attention works in a transformer"');
    expect(taught).toContain('intuition');
  });

  it('treats a new idea named like one on the map as that idea: planned from what is known, taught once', async () => {
    const { db, id, maker, deps } = setup();
    const known = (k: string) => id(k);
    const proposal = {
      title: 'Equilibria',
      summary: 'What makes a profile stable.',
      level: 'working',
      ideas: [
        { ref: known('nash'), aim: 2, why: 'On the map already.' },
        { ref: 'n1', aim: 2, why: 'Written as new by mistake.' },
      ],
      newIdeas: [{ tempId: 'n1', kind: 'term', name: 'nash  Equilibrium', statement: 'A stable profile.', premises: [] }],
      background: [],
    };
    deps.provider = new FakeProvider({ tutor, planner, sessionPlanner: [proposal] });
    recordEvidence(db, { nodeId: known('nash'), kind: 'explain', score: 0.9, reasoning: 't' });
    const made = await maker.make(deps, { description: 'Nash equilibrium', goalId: null });
    const plan = previewFree(db, maker, { goalId: null, counted: false, proposalId: made.id });
    expect(plan.ideas).toHaveLength(1);
    expect(plan.ideas[0]).toMatchObject({ ref: known('nash'), state: expect.not.stringMatching('new') });
    expect(plan.ideas[0]?.fromDepth).toBeGreaterThan(0);
    const snap = await startFreeSession(deps, maker, { goalId: null, counted: false, proposalId: made.id });
    expect(snap.plan.steps.map((s) => s.nodeId)).toEqual([known('nash')]);
  });

  it('books the time to the goal when counted, and to free study when not or with no goal', async () => {
    const { db, id, maker, deps } = setup();
    const goal = gameTheoryGoal(db, id);
    const now = new Date();
    const minuteIn = async (choice: Parameters<typeof startFreeSession>[2]) => {
      const snap = await respond(deps, (await startFreeSession(deps, maker, choice)).id, { answer: '' });
      expect(snap.phase).toBe('teach');
      tick(db, { surface: 'session', seconds: 60 }, now);
      await abandonSession(deps, snap.id);
    };
    await minuteIn({ goalId: goal.id, counted: true, pick: [id('nash')] });
    expect(spentByGoal(attributeTime(db)).get(goal.id)).toBe(1);
    expect(freeStudy(db)).toHaveLength(0);

    // the goal's own idea, but not counted: free study, never the goal's through its ideas
    await minuteIn({ goalId: goal.id, counted: false, pick: [id('nash')] });
    await minuteIn({ goalId: null, counted: false, pick: [id('dominant')] });
    expect(spentByGoal(attributeTime(db)).get(goal.id)).toBe(1);
    expect(freeStudy(db).map((s) => s.minutes)).toEqual([1, 1]);

    const stats = statsView(db, { goalId: null, topicId: null, range: 'all' }, now);
    expect(stats.freeMinutes).toBe(2);
    expect(stats.headline.minutes).toBe(3);
    expect(stats.weeks.at(-1)?.minutes).toMatchObject({ [goal.id]: 1, free: 2 });
    expect(statsView(db, { goalId: goal.id, topicId: null, range: 'all' }, now).freeMinutes).toBe(0);
  });

  it('counts free study on a goal\u2019s ideas as time studied, so learning there does not look faster', () => {
    const { db, id } = setup();
    gameTheoryGoal(db, id);
    expect(learnerSpeedNow(db)).toBe(1);
    // depth gained on the goal's ideas, in free sessions only, over two slow hours
    for (const key of ['nash', 'bestResponse']) recordEvidence(db, { nodeId: id(key), kind: 'explain', score: 0.95, reasoning: 't' });
    for (const key of ['nash', 'bestResponse']) logTime(db, 'free', { goalId: null, sessionId: 'session_free', nodeId: id(key) }, 3600);
    expect(learnerSpeedNow(db)).toBeGreaterThan(1);
  });

  it('does not carry a half-done idea of a chosen session into the goal’s planned sessions', async () => {
    const { db, id, maker, deps } = setup();
    const goal = gameTheoryGoal(db, id);
    let snap = await startFreeSession(deps, maker, { goalId: goal.id, counted: true, pick: [id('bestResponse')] });
    snap = await respond(deps, snap.id, { answer: '' });
    expect(snap.current?.name).toBe('Best response');
    await abandonSession(deps, snap.id);

    const planned = await startSession(deps, goal.id);
    const state = getSession<SessionState>(db, planned.id)?.state;
    expect(state?.resume).toBeNull();
    expect(planned.plan.title).toBe('The goal’s own session');
    expect(listSessionEvents(db, planned.id).some((e) => e.payload['carriedFrom'])).toBe(false);
  });

  it('keeps the half-done idea of a planned session when a counted chosen session comes between', async () => {
    const { db, id, maker, deps } = setup();
    const goal = gameTheoryGoal(db, id);
    let first = await respond(deps, (await startSession(deps, goal.id)).id, { answer: '' });
    expect(first.phase).toBe('teach');
    first = await respond(deps, first.id, { answer: 'my answer', confidence: 0.9 });
    const halfDone = first.current?.nodeId;
    await abandonSession(deps, first.id);

    const chosen = await respond(deps, (await startFreeSession(deps, maker, { goalId: goal.id, counted: true, pick: [id('dominant')] })).id, { answer: '' });
    await abandonSession(deps, chosen.id);

    const planned = await startSession(deps, goal.id);
    const state = getSession<SessionState>(db, planned.id)?.state;
    expect(state?.resume?.nodeId).toBe(halfDone);
    expect(state?.resume?.fromSessionId).toBe(first.id);
  });

  it('refuses to open a chosen session while one is open, and shows what was asked in Trails', async () => {
    const { db, id, maker, deps } = setup();
    const snap = await startFreeSession(deps, maker, { goalId: null, counted: false, pick: [id('dominant'), id('dominated')] });
    await expect(startFreeSession(deps, maker, { goalId: null, counted: false, pick: [id('nash')] })).rejects.toThrow('A session is open');
    expect(listTrails(db)[0]).toMatchObject({ id: snap.id, asked: { description: null, picked: ['Strictly dominant strategy', 'Strictly dominated strategy'] } });
  });
});
