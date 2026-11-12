import { describe, expect, it } from 'vitest';
import { remapCauses } from '../core/goals';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { openDatabase } from '../store/db';
import { addCapabilities, createGoal, getGoal, listTargets, markCompiled, updateGoal } from '../store/goals';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { goalProgress } from './budget';
import { approveGoalPlan, createGoalFromForm, goalDetail, updateGoalFromForm } from './goals';
import { compileGoal, compileInput } from './goalCompile';
import { nextGoalStep } from './goalWorker';
import { refreshGoalFields } from './knowledge';
import { proposeRemap, remapView } from './remap';
import { todayView } from './today';

function setup() {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const id = (k: string) => ids.get(k) as string;
  return { db, id };
}

const GAME_IDEAS = ['nash', 'bestResponse', 'findPureNash', 'nashMutualBr', 'dominant', 'dominated', 'iesds', 'dominantNash', 'spe', 'backwardInduction'];

/** A mapped, approved goal over the seed graph, every idea wanted at depth 3. */
function mappedGoal(db: ReturnType<typeof setup>['db'], id: (k: string) => string, time: { hours: number } | { level: 'intuition' | 'working' | 'rigorous' }) {
  const goal = createGoalFromForm(
    db,
    { text: 'Understand how strategic games are solved', budget: 'hours' in time ? { mode: 'total', hours: time.hours } : null, wantedLevel: 'level' in time ? time.level : null, materials: [] },
    { draft: true },
  );
  addCapabilities(db, goal.id, [
    { statement: 'Can find Nash equilibria', targets: GAME_IDEAS.slice(0, 4).map((k) => ({ nodeId: id(k), depth: 3 as const })) },
    { statement: 'Can use dominance', targets: GAME_IDEAS.slice(4, 8).map((k) => ({ nodeId: id(k), depth: 3 as const })) },
    { statement: 'Can solve sequential games', targets: GAME_IDEAS.slice(8).map((k) => ({ nodeId: id(k), depth: 3 as const })) },
  ]);
  markCompiled(db, goal.id, 'Strategic games', [], { level: 'working', scope: 'Find and explain equilibria in small games.' });
  approveGoalPlan(db, goal.id);
  return goal;
}

/** A first compile of a goal with no material: three skills, one new idea each, at the level the model picked. */
function compiler(level: string, check: (text: string) => void) {
  return (req: CompleteRequest<unknown>) => {
    check(req.messages[0]?.content ?? '');
    return {
      title: 'Strategic games',
      level,
      scope: 'What a stable choice is when others choose too, and how to find one.',
      capabilities: ['Equilibrium', 'Dominance', 'Backward induction'].map((name, i) => ({ statement: `Can explain ${name.toLowerCase()} on a small game`, targets: [{ ref: `m${i + 1}`, depth: 2, core: i === 0 }] })),
      newNodes: ['Equilibrium', 'Dominance', 'Backward induction'].map((name, i) => ({ tempId: `m${i + 1}`, kind: 'claim', name, statement: `${name}, on a small game.` })),
    };
  };
}

describe('goals without a time limit', () => {
  it('has a time or no time limit, never both', () => {
    const { db } = setup();
    expect(() => createGoal(db, { text: 'x', budget: { mode: 'total', hours: 5 }, wantedLevel: 'working' })).toThrow(/either a time or no time limit/);
    const goal = createGoal(db, { text: 'x', budget: { mode: 'total', hours: 5 } });
    updateGoal(db, goal.id, { wantedLevel: 'rigorous' });
    expect(getGoal(db, goal.id)).toMatchObject({ budget: null, wantedLevel: 'rigorous' });
    updateGoal(db, goal.id, { budget: { mode: 'total', hours: 3 } });
    expect(getGoal(db, goal.id)).toMatchObject({ budget: { mode: 'total', hours: 3 }, wantedLevel: null });
  });

  it('compiles by the wanted level with no time section, and keeps that level whatever the model says', async () => {
    const { db } = setup();
    const goal = createGoalFromForm(db, { text: 'Understand how strategic games are solved', wantedLevel: 'intuition', context: 'For a talk to my team.', materials: [] }, { draft: true });
    const { input } = compileInput(db, getGoal(db, goal.id) ?? goal);
    expect(input).toMatchObject({ wantedLevel: 'intuition', budgetHours: null });
    const provider = new FakeProvider({
      goalCompiler: compiler('working', (text) => {
        expect(text).toContain('## How deep: no time limit');
        expect(text).toContain('the big picture');
        expect(text).toContain('For a talk to my team.');
        expect(text).not.toContain('## Time');
      }),
    });
    await compileGoal({ db, provider }, goal.id);
    expect(getGoal(db, goal.id)?.level).toBe('intuition');

    // a goal fitted to a time still gets the time, and an old goal with no budget gets neither
    const timed = createGoalFromForm(db, { text: 'Strategic games', budget: { mode: 'total', hours: 6 }, materials: [] }, { draft: true });
    expect(compileInput(db, timed).input).toMatchObject({ wantedLevel: null, budgetHours: 6 });
    const legacy = createGoalFromForm(db, { text: 'Strategic games', materials: [] }, { draft: true });
    expect(compileInput(db, legacy).input).toMatchObject({ wantedLevel: null, budgetHours: null });
  });

  it('plans every idea at full depth, shows an estimate and no pace verdict, and the scheduler gives it plain days', () => {
    const { db, id } = setup();
    const open = mappedGoal(db, id, { level: 'working' });
    refreshGoalFields(db);
    const targets = listTargets(db, open.id, { all: true });
    expect(targets.every((t) => t.depth === t.idealDepth && t.approvedDepth === t.idealDepth)).toBe(true);
    const progress = goalProgress(db, open.id);
    expect(progress).toMatchObject({ noLimit: true, totalMinutes: null, weeklyTarget: null, expectedByNow: null });
    expect(progress?.plan.ideas.cut).toBe(0);
    expect(progress?.plan.plannedMinutes).toBeGreaterThan(0);
    const today = todayView(db).goals.find((g) => g.goalId === open.id);
    expect(today?.schedule.dailyMinutes).toBe(40);
    expect(todayView(db).week.minutesTarget).toBe(0);
  });

  it('switching between a time and no time limit re-plans at once and proposes a new map', async () => {
    const { db, id } = setup();
    const goal = mappedGoal(db, id, { hours: 1 });
    expect(listTargets(db, goal.id, { all: true }).some((t) => t.depth < t.idealDepth)).toBe(true);

    updateGoalFromForm(db, goal.id, { budget: null, wantedLevel: 'rigorous' });
    expect(listTargets(db, goal.id, { all: true }).every((t) => t.depth === t.idealDepth && t.approvedDepth === t.idealDepth)).toBe(true);
    expect(getGoal(db, goal.id)?.remap).toMatchObject({ state: 'requested', causes: ['level'] });
    expect(nextGoalStep(db, goal.id)).toBe('remap');
    const provider = new FakeProvider({
      goalCompiler: (req: CompleteRequest<unknown>) => {
        const text = req.messages[0]?.content ?? '';
        expect(text).toContain('## How deep: no time limit');
        expect(text).toContain('changed how this goal is sized');
        return { title: 'Strategic games in full', scope: 'Equilibria with their proofs.', capabilities: [{ statement: 'Can prove that dominant strategies form the unique equilibrium', targets: [{ ref: id('dominantNash'), depth: 3, core: true }] }], newNodes: [] };
      },
    });
    await proposeRemap({ db, provider }, goal.id);
    const view = remapView(db, goal.id);
    expect(view?.level).toBe('rigorous');
    expect(view?.reason).toBe('You chose to learn it in full, with no time limit. The new map holds what that depth needs.');

    // back to a time: the plan fits it at once, and a map sized to it is asked for
    updateGoalFromForm(db, goal.id, { budget: { mode: 'total', hours: 1 }, wantedLevel: null });
    expect(getGoal(db, goal.id)?.remap).toMatchObject({ state: 'requested', causes: ['level'] });
    expect(listTargets(db, goal.id, { all: true }).some((t) => t.depth < t.idealDepth)).toBe(true);
    expect(goalDetail(db, goal.id)?.progress?.noLimit).toBe(false);
    // a new amount of time is not a new map
    const before = getGoal(db, goal.id)?.remap;
    updateGoalFromForm(db, goal.id, { budget: { mode: 'total', hours: 3 } });
    expect(getGoal(db, goal.id)?.remap).toEqual(before);
  });

  it('leaves goals from before time budgets alone', () => {
    const { db, id } = setup();
    const goal = createGoalFromForm(db, { text: 'Old goal', materials: [] });
    addCapabilities(db, goal.id, [{ statement: 'Can find Nash equilibria', targets: [{ nodeId: id('nash'), depth: 2 }] }]);
    markCompiled(db, goal.id, null, []);
    refreshGoalFields(db);
    expect(getGoal(db, goal.id)?.wantedLevel).toBeNull();
    expect(goalProgress(db, goal.id)?.noLimit).toBe(false);
    expect(remapCauses({ context: null, wantedLevel: null }, { context: null, wantedLevel: 'working' })).toEqual(['level']);
    expect(remapCauses({ context: null, wantedLevel: 'working' }, { context: null, wantedLevel: 'working' })).toEqual([]);
  });
});
