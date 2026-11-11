import { describe, expect, it } from 'vitest';
import { buildAdditionSchema } from '../agents/goalAddition';
import { allocate } from '../core/budget';
import { FakeEmbedder } from '../ingest/embedder';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { openDatabase } from '../store/db';
import { addCapabilities, getGoal, listCapabilities, listTargets, markCapabilityMastered, markCompiled, requestRemap, saveAddition, saveRemap } from '../store/goals';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { listNodes } from '../store/world';
import { additionView, applyAddition, dismissAddition, proposeAddition, requestAddition } from './addition';
import { applyCompile, approveGoalPlan, createGoalFromForm, goalDetail } from './goals';
import { nextGoalStep } from './goalWorker';
import { candidatesForGoal } from './planner';
import { noteBackgroundGaps } from './remap';

function setup() {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const id = (k: string) => ids.get(k) as string;
  return { db, id };
}

const NASH = ['nash', 'bestResponse', 'findPureNash', 'nashMutualBr', 'dominant', 'dominated', 'iesds', 'dominantNash'];

/** A mapped, approved goal on simultaneous games, with a fixed time or none. */
function mappedGoal(db: ReturnType<typeof setup>['db'], id: (k: string) => string, time: { hours: number } | 'none') {
  const goal = createGoalFromForm(
    db,
    {
      text: 'Understand how strategic games are solved',
      budget: time === 'none' ? null : { mode: 'total', hours: time.hours },
      wantedLevel: time === 'none' ? 'working' : null,
      context: 'For reading papers on pricing.',
      materials: [],
    },
    { draft: true },
  );
  addCapabilities(db, goal.id, [
    { statement: 'Can find Nash equilibria', targets: NASH.slice(0, 4).map((k) => ({ nodeId: id(k), depth: 3 as const, core: k === 'nash' })) },
    { statement: 'Can use dominance', targets: NASH.slice(4).map((k) => ({ nodeId: id(k), depth: 2 as const })) },
  ]);
  markCompiled(db, goal.id, 'Strategic games', [], { level: 'working', scope: 'Find and explain equilibria in small games.' });
  approveGoalPlan(db, goal.id);
  return getGoal(db, goal.id) ?? goal;
}

/** An addition on sequential games: one library idea taken to depth 2 and two new ideas. */
function sequentialAddition(id: (k: string) => string, options: { fits?: boolean; check?: (text: string) => void } = {}) {
  return (req: CompleteRequest<unknown>) => {
    options.check?.(req.messages[0]?.content ?? '');
    return {
      fits: options.fits ?? true,
      reason: options.fits === false ? 'Sequential games are a subject of their own here.' : null,
      shape: 'deep',
      capabilities: [
        {
          statement: 'Can solve a sequential game by backward induction and say why the threat is credible',
          targets: [
            { ref: id('backwardInduction'), depth: 3, core: true },
            { ref: 'm1', depth: 2, core: false },
            { ref: 'm2', depth: 2, core: false },
          ],
        },
      ],
      newNodes: [
        { tempId: 'm1', kind: 'claim', name: 'Commitment changes the game', statement: 'Moving first and committing can change which outcome is stable.' },
        { tempId: 'm2', kind: 'claim', name: 'Price leadership', statement: 'A firm that sets its price first shapes the follower’s best response.' },
      ],
    };
  };
}

describe('adding to a goal', () => {
  it('validates what the compiler adds: a reason when it does not fit, known ids, new ideas that are used', () => {
    const schema = buildAdditionSchema(new Set(['node_a']));
    const ok = { fits: true, shape: 'broad', capabilities: [{ statement: 'Can relate the goal to the wider field', targets: [{ ref: 'node_a', depth: 1 }, { ref: 'm1', depth: 2 }] }], newNodes: [{ tempId: 'm1', kind: 'claim', name: 'A link', statement: 'How the two relate.' }] };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ ...ok, fits: false }).success).toBe(false);
    expect(schema.safeParse({ ...ok, fits: false, reason: 'It is a different subject altogether.' }).success).toBe(true);
    expect(schema.safeParse({ ...ok, capabilities: [{ statement: 'Can relate the goal to the wider field', targets: [{ ref: 'node_ghost', depth: 1 }] }] }).success).toBe(false);
    expect(schema.safeParse({ ...ok, newNodes: [...ok.newNodes, { tempId: 'm2', kind: 'term', name: 'Unused', statement: 'Never targeted.' }] }).success).toBe(false);
    expect(schema.safeParse({ ...ok, shape: 'wide' }).success).toBe(false);
  });

  it('works out a request in the background with the goal, its map and matching library ideas', async () => {
    const { db, id } = setup();
    const goal = mappedGoal(db, id, { hours: 6 });
    expect(() => requestAddition(db, goal.id, '   ')).toThrow(/Say what you want to add/);
    requestAddition(db, goal.id, '  How backward induction works in sequential games ');
    expect(getGoal(db, goal.id)?.addition).toMatchObject({ state: 'requested', request: 'How backward induction works in sequential games' });
    expect(nextGoalStep(db, goal.id)).toBe('add');
    const provider = new FakeProvider({
      goalCompiler: sequentialAddition(id, {
        check: (text) => {
          expect(text).toContain('## The learner\'s request\n“How backward induction works in sequential games”');
          expect(text).toContain("## The learner's context\nFor reading papers on pricing.");
          expect(text).toContain('fixed time of about 6 hours');
          expect(text).toContain('- [cap_'); // the current map
          expect(text).toContain(`[${id('backwardInduction')}] Backward induction (procedure, in the library)`);
          expect(text).toContain(`[${id('nash')}] Nash equilibrium (term, in this goal)`);
        },
      }),
    });
    await proposeAddition({ db, provider, embedder: new FakeEmbedder() }, goal.id);
    expect(provider.calls[0]?.role).toBe('goalCompiler');
    expect(getGoal(db, goal.id)?.addition?.state).toBe('ready');
    expect(nextGoalStep(db, goal.id)).toBeNull();
  });

  it('previews the change and makes it only when the learner says yes, keeping what was there', async () => {
    const { db, id } = setup();
    const goal = mappedGoal(db, id, { hours: 6 });
    markCapabilityMastered(db, listCapabilities(db, goal.id)[1]?.id as string);
    const before = { caps: listCapabilities(db, goal.id), targets: listTargets(db, goal.id, { all: true }), nodes: listNodes(db).length };
    requestAddition(db, goal.id, 'How backward induction works');
    await proposeAddition({ db, provider: new FakeProvider({ goalCompiler: sequentialAddition(id) }) }, goal.id);

    const view = additionView(db, goal.id);
    expect(view).toMatchObject({ request: 'How backward induction works', fits: true, shape: 'deep', totalMinutes: 360 });
    expect(view?.skills).toEqual(['Can solve a sequential game by backward induction and say why the threat is credible']);
    expect(view?.ideas.map((i) => i.name).sort()).toEqual(['Backward induction', 'Commitment changes the game', 'Price leadership']);
    // the preview wrote nothing
    expect(listCapabilities(db, goal.id)).toEqual(before.caps);
    expect(listNodes(db)).toHaveLength(before.nodes);

    applyAddition(db, goal.id);
    const caps = listCapabilities(db, goal.id);
    expect(caps.slice(0, 2)).toEqual(before.caps);
    expect(caps[2]).toMatchObject({ request: 'How backward induction works', masteredAt: null });
    const kept = listTargets(db, goal.id, { all: true }).filter((t) => t.capabilityId !== caps[2]?.id);
    expect(kept.map((t) => [t.nodeId, t.approvedDepth])).toEqual(before.targets.map((t) => [t.nodeId, t.approvedDepth]));
    const added = listTargets(db, goal.id, { all: true }).filter((t) => t.capabilityId === caps[2]?.id);
    expect(added).toHaveLength(3);
    expect(added.every((t) => t.approvedDepth !== null)).toBe(true);
    // the new ideas are taught from the model's knowledge at once, like a goal from scratch
    const fresh = listNodes(db).filter((n) => n.name === 'Commitment changes the game' || n.name === 'Price leadership');
    expect(fresh.every((n) => n.status === 'unverified')).toBe(true);
    expect(getGoal(db, goal.id)?.startedUnverified.sort()).toEqual(fresh.map((n) => n.id).sort());
    expect(candidatesForGoal(db, goal.id).candidates.some((c) => fresh.some((n) => n.id === c.nodeId))).toBe(true);
    expect(getGoal(db, goal.id)?.addition).toBeNull();
    expect(goalDetail(db, goal.id)?.capabilities[2]?.request).toBe('How backward induction works');
  });

  it('a new map drawn after an addition keeps the learner\u2019s words on the ideas they asked for', async () => {
    const { db, id } = setup();
    const goal = mappedGoal(db, id, { hours: 6 });
    requestAddition(db, goal.id, 'How backward induction works');
    await proposeAddition({ db, provider: new FakeProvider({ goalCompiler: sequentialAddition(id) }) }, goal.id);
    applyAddition(db, goal.id);
    const now = getGoal(db, goal.id) ?? goal;
    applyCompile(
      db,
      now,
      {
        title: 'Strategic games',
        level: 'working',
        scope: 'Equilibria, simultaneous and sequential.',
        coverage: undefined,
        capabilities: [
          { statement: 'Can find Nash equilibria', targets: [{ ref: id('nash'), depth: 3, core: true }] },
          { statement: 'Can reason backwards through a game tree', targets: [{ ref: id('backwardInduction'), depth: 3, core: false }] },
        ],
        extend: [],
        retire: [],
        newNodes: [],
      },
      now.compiledSources,
      { replace: true },
    );
    const caps = listCapabilities(db, goal.id);
    expect(caps.map((c) => c.request)).toEqual([null, 'How backward induction works']);
  });

  it('keeps a fixed time: the plan makes room elsewhere, and the request is not what gets left out', async () => {
    const { db, id } = setup();
    const goal = mappedGoal(db, id, { hours: 4.5 });
    requestAddition(db, goal.id, 'How backward induction works');
    await proposeAddition({ db, provider: new FakeProvider({ goalCompiler: sequentialAddition(id) }) }, goal.id);
    const view = additionView(db, goal.id);
    expect(view?.totalMinutes).toBe(270);
    // room is made among the goal's other ideas; which ones follows from the costs (a missing premise is charged once)
    expect(view?.changes).toEqual({ overview: [], leftOut: ['Best response', 'Find pure Nash equilibria in a matrix'], shallower: [], missed: [] });
    expect(view?.ideas.map((i) => [i.name, i.plannedDepth])).toEqual([
      ['Backward induction', 3],
      ['Commitment changes the game', 2],
      ['Price leadership', 2],
    ]);
    applyAddition(db, goal.id);
    expect(goalDetail(db, goal.id)?.progress?.totalMinutes).toBe(270);
    expect(goalDetail(db, goal.id)?.progress?.plan.plannedMinutes).toBeLessThanOrEqual(270);
  });

  it('grows the estimate of a goal with no time limit instead', async () => {
    const { db, id } = setup();
    const goal = mappedGoal(db, id, 'none');
    requestAddition(db, goal.id, 'How backward induction works');
    await proposeAddition({ db, provider: new FakeProvider({ goalCompiler: sequentialAddition(id, { check: (text) => expect(text).toContain('no time limit') }) }) }, goal.id);
    const view = additionView(db, goal.id);
    expect(view?.totalMinutes).toBeNull();
    expect(view?.addedMinutes).toBeGreaterThanOrEqual(25 * 2 + 30);
    expect(view?.changes).toEqual({ overview: [], leftOut: [], shallower: [], missed: [] });
  });

  it('says when a request is not a fit, and dropping it changes nothing', async () => {
    const { db, id } = setup();
    const goal = mappedGoal(db, id, { hours: 6 });
    requestAddition(db, goal.id, 'How backward induction plays chess');
    await proposeAddition({ db, provider: new FakeProvider({ goalCompiler: sequentialAddition(id, { fits: false }) }) }, goal.id);
    expect(additionView(db, goal.id)).toMatchObject({ fits: false, reason: 'Sequential games are a subject of their own here.' });
    const caps = listCapabilities(db, goal.id);
    dismissAddition(db, goal.id);
    expect(getGoal(db, goal.id)?.addition).toBeNull();
    expect(listCapabilities(db, goal.id)).toEqual(caps);
  });

  it('keeps a failure to show, drops a result for a request changed meanwhile, and holds re-maps back while it waits', async () => {
    const { db, id } = setup();
    const goal = mappedGoal(db, id, { hours: 6 });
    requestAddition(db, goal.id, 'How backward induction works');
    await proposeAddition({ db, provider: new FakeProvider() }, goal.id);
    expect(getGoal(db, goal.id)?.addition).toMatchObject({ state: 'failed', request: 'How backward induction works' });
    expect(nextGoalStep(db, goal.id)).toBeNull();

    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    requestAddition(db, goal.id, 'How backward induction works');
    const running = proposeAddition({ db, provider: new FakeProvider({ goalCompiler: async (req: CompleteRequest<unknown>) => (await held, sequentialAddition(id)(req)) }) }, goal.id);
    requestAddition(db, goal.id, 'How commitment works in pricing');
    release();
    await running;
    expect(getGoal(db, goal.id)?.addition).toMatchObject({ state: 'requested', request: 'How commitment works in pricing' });

    // a gap that would call for a re-map waits until the addition is settled
    noteBackgroundGaps(db, goal.id, [{ name: 'Extensive-form games', hours: 1 }], 'session');
    expect(nextGoalStep(db, goal.id)).toBe('add');
    dismissAddition(db, goal.id);
    expect(nextGoalStep(db, goal.id)).toBe('remap');
  });

  it('never works out an addition while a new map is drawn or waits, so approving the map cannot wipe it', () => {
    const { db, id } = setup();
    const goal = mappedGoal(db, id, { hours: 6 });
    requestRemap(db, goal.id, ['level']);
    expect(() => requestAddition(db, goal.id, 'How backward induction works')).toThrow(/Wait until the new map is drawn/);
    // an addition already asked for waits until the map is settled
    saveAddition(db, goal.id, { state: 'requested', request: 'How backward induction works', at: new Date().toISOString() });
    expect(nextGoalStep(db, goal.id)).toBe('remap');
    saveRemap(db, goal.id, null);
    expect(nextGoalStep(db, goal.id)).toBe('add');
  });

  it('gives what the learner asked for more weight in a tight plan', () => {
    const nodes = new Map(['asked', 'other'].map((nodeId) => [nodeId, { id: nodeId, kind: 'claim' as const, depth: 0 as const, centrality: 0 }]));
    const targets = [
      { goalId: 'g', capabilityId: 'c1', nodeId: 'other', idealDepth: 2 as const },
      { goalId: 'g', capabilityId: 'c2', nodeId: 'asked', idealDepth: 2 as const, requested: true },
    ];
    const plan = allocate([{ id: 'g', budgetMinutes: 30, spentMinutes: 0, priority: 1 }], targets, nodes);
    expect(plan.nodeDepth.get('asked')).toBe(2);
    expect(plan.nodeDepth.get('other')).toBeLessThan(2);
  });
});
