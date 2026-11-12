import { describe, expect, it } from 'vitest';
import { runTutorStep } from '../agents/tutor';
import { remapCauses } from '../core/goals';
import { CONTEXT_MAX_CHARS } from '../core/types';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { openDatabase } from '../store/db';
import { addCapabilities, getGoal, listCapabilities, markCompiled } from '../store/goals';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { approveGoalPlan, compileGoal, createGoalFromForm, updateGoalFromForm } from './goals';
import { nextGoalStep } from './goalWorker';
import { createProbe } from './probe';
import { proposeRemap, redrawDraft, remapView } from './remap';

const CONTEXT = 'For reading game theory papers in economics. Skip mixed strategies; I care about sequential games.';

function setup() {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const id = (k: string) => ids.get(k) as string;
  return { db, id };
}

/** A goal with two skills over the seed graph, mapped and (unless a draft) approved. */
function mappedGoal(db: ReturnType<typeof setup>['db'], id: (k: string) => string, options: { draft?: boolean; context?: string | null } = {}) {
  const goal = createGoalFromForm(db, { text: 'Understand how strategic games are solved', budget: { mode: 'total', hours: 6 }, context: options.context ?? null, materials: [] }, { draft: true });
  addCapabilities(db, goal.id, [
    { statement: 'Can find Nash equilibria', targets: ['nash', 'bestResponse'].map((k) => ({ nodeId: id(k), depth: 2 as const })) },
    { statement: 'Can solve a game by dominance', targets: ['dominant', 'iesds'].map((k) => ({ nodeId: id(k), depth: 2 as const })) },
  ]);
  markCompiled(db, goal.id, 'Strategic games', [], { level: 'working', scope: 'Find and explain equilibria in small games.' });
  if (!options.draft) approveGoalPlan(db, goal.id);
  return goal;
}

const SEQUENTIAL = ['Backward induction', 'Subgame perfection', 'Credible threats'];

/** A compiler that draws the map anew around sequential games (the goal has no material), and checks what it was told. */
function redrawingCompiler(expectText: string[]) {
  return (req: CompleteRequest<unknown>) => {
    const text = req.messages[0]?.content ?? '';
    for (const t of expectText) expect(text).toContain(t);
    return {
      title: 'Sequential games',
      level: 'working',
      scope: 'Solve sequential games by backward induction, as papers do.',
      capabilities: SEQUENTIAL.map((name, i) => ({ statement: `Can use ${name.toLowerCase()} in a sequential game`, targets: [{ ref: `m${i + 1}`, depth: 2, core: i === 0 }] })),
      newNodes: SEQUENTIAL.map((name, i) => ({ tempId: `m${i + 1}`, kind: 'claim', name, statement: `${name}, as it is used to solve games played in turns.` })),
    };
  };
}

describe('goal context', () => {
  it('is stored trimmed, read by every compile, and refused when too long', async () => {
    const { db } = setup();
    const goal = createGoalFromForm(db, { text: 'Understand how strategic games are solved', context: `  ${CONTEXT}\n`, materials: [] }, { draft: true });
    expect(getGoal(db, goal.id)?.context).toBe(CONTEXT);
    const provider = new FakeProvider({ goalCompiler: redrawingCompiler([`## The learner's context\n${CONTEXT}`]) });
    await compileGoal({ db, provider }, goal.id);
    expect(provider.calls).toHaveLength(1);
    expect(() => updateGoalFromForm(db, goal.id, { context: 'x'.repeat(CONTEXT_MAX_CHARS + 1) })).toThrow(/at most 4,000 characters/);
    updateGoalFromForm(db, goal.id, { context: '   ' });
    expect(getGoal(db, goal.id)?.context).toBeNull();
  });

  it('asks a mapped goal for a new map to approve when the context changes, and nothing else does', async () => {
    const { db, id } = setup();
    const goal = mappedGoal(db, id);
    updateGoalFromForm(db, goal.id, { text: 'Understand how games are solved', budget: { mode: 'total', hours: 8 } });
    expect(getGoal(db, goal.id)?.remap).toBeNull();
    updateGoalFromForm(db, goal.id, { context: CONTEXT });
    expect(getGoal(db, goal.id)?.remap).toMatchObject({ state: 'requested', causes: ['context'] });
    expect(nextGoalStep(db, goal.id)).toBe('remap');

    const caps = listCapabilities(db, goal.id).map((c) => c.id);
    const provider = new FakeProvider({ goalCompiler: redrawingCompiler([`## The learner's context\n${CONTEXT}`, "The learner changed the goal's context"]) });
    await proposeRemap({ db, provider }, goal.id);
    // a proposal, not a change: the learner sees it next to their map
    expect(listCapabilities(db, goal.id).map((c) => c.id)).toEqual(caps);
    expect(remapView(db, goal.id)?.reason).toMatch(/^Your context changed\./);
  });

  it('maps a draft again at once when its context changes, with its last map as a guide', async () => {
    const { db, id } = setup();
    const goal = mappedGoal(db, id, { draft: true });
    updateGoalFromForm(db, goal.id, { context: `  ${CONTEXT}` });
    expect(nextGoalStep(db, goal.id)).toBe('redraw');
    const provider = new FakeProvider({ goalCompiler: redrawingCompiler([CONTEXT, 'The current map (it is replaced', 'Can find Nash equilibria']) });
    await redrawDraft({ db, provider }, goal.id);
    expect(listCapabilities(db, goal.id).map((c) => c.statement)).toEqual(SEQUENTIAL.map((n) => `Can use ${n.toLowerCase()} in a sequential game`));
    expect(getGoal(db, goal.id)?.remap).toBeNull();
    expect(getGoal(db, goal.id)?.status).toBe('draft');
    expect(nextGoalStep(db, goal.id)).toBeNull();
  });

  it('keeps a change made while a draft is first mapped, and drops one the first map already read', async () => {
    const { db } = setup();
    const goal = createGoalFromForm(db, { text: 'Understand how strategic games are solved', materials: [] }, { draft: true });
    // changed before the first map began: that map reads the new context, so no second one
    updateGoalFromForm(db, goal.id, { context: CONTEXT });
    await compileGoal({ db, provider: new FakeProvider({ goalCompiler: redrawingCompiler([CONTEXT]) }) }, goal.id);
    expect(nextGoalStep(db, goal.id)).toBeNull();

    // changed while a map is being drawn: the map in flight is from before, so it is drawn again after
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const slow = new FakeProvider({ goalCompiler: async (req: CompleteRequest<unknown>) => (await held, redrawingCompiler([])(req)) });
    updateGoalFromForm(db, goal.id, { context: 'For an exam' });
    const running = redrawDraft({ db, provider: slow }, goal.id);
    updateGoalFromForm(db, goal.id, { context: 'For an exam next week' });
    release();
    await running;
    expect(getGoal(db, goal.id)?.remap).toMatchObject({ state: 'requested', causes: ['context'] });
    expect(nextGoalStep(db, goal.id)).toBe('redraw');
  });

  it('reaches the prober and the tutor as one short section', async () => {
    const { db, id } = setup();
    const goal = mappedGoal(db, id, { context: CONTEXT });
    const prober = new FakeProvider({
      prober: (req: CompleteRequest<unknown>) => {
        const text = req.messages[0]?.content ?? '';
        expect(text).toContain(`## The learner's context\n${CONTEXT}`);
        const nodeId = /- \[(node_[a-z0-9_]+)\]/.exec(text)?.[1];
        return { questions: [{ nodeId, kind: 'check', question: 'What makes a pair of choices stable?', answerKey: 'Nobody gains alone.', rubric: ['unilateral'] }] };
      },
    });
    await createProbe(db, prober, goal.id);
    expect(prober.calls).toHaveLength(1);

    const tutor = new FakeProvider({ tutor: [{ grade: null, card: { stage: 'predict', prompt: 'Two firms set prices at once. What would make them stop changing?' } }] });
    await runTutorStep(tutor, {
      goal: { text: 'Understand how strategic games are solved', level: 'working', scope: null, assessment: 'none', focus: [], context: CONTEXT },
      why: 'everything builds on it',
      node: { id: id('nash'), kind: 'claim', name: 'Nash equilibrium', statement: 'No player gains by deviating alone.' },
      aim: 2,
      simplified: null,
      premises: [],
      dependents: [],
      bugs: [],
      examples: [],
      excerpts: [],
      figures: [],
      history: [],
      previous: null,
      nextStage: 'predict',
    });
    expect(tutor.calls[0]?.messages[0]?.content).toContain(`The learner's context: ${CONTEXT}`);
  });

  it('counts only a real change of the context as a cause', () => {
    expect(remapCauses({ context: null, wantedLevel: null }, { context: '  ', wantedLevel: null })).toEqual([]);
    expect(remapCauses({ context: 'For work', wantedLevel: null }, { context: 'For work ', wantedLevel: null })).toEqual([]);
    expect(remapCauses({ context: null, wantedLevel: null }, { context: 'For work', wantedLevel: null })).toEqual(['context']);
  });
});
