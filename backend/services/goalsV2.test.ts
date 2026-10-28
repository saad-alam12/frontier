import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { FakeEmbedder } from '../ingest/embedder';
import { openDatabase } from '../store/db';
import { createGoal, getGoal, listCapabilities, markCapabilityMastered, setMaterials, startUnverified } from '../store/goals';
import { listNodes } from '../store/world';
import { IngestionService } from './ingestion';
import { compileGoal, createGoalFromForm, goalDetail, guessRole, nextGoalStep, profileGoal } from './goals';
import { candidatesForGoal } from './planner';

/** Extractor fixture: `NODE name: statement` and `CHAIN a + b => c` lines. */
function extractor(req: CompleteRequest<unknown>) {
  const text = req.messages[0]?.content ?? '';
  const nodes = [...text.matchAll(/NODE ([^:\n]+): ([^\n]+)/g)].map((m, i) => ({ tempId: `n${i + 1}`, kind: 'claim', name: (m[1] as string).trim(), statement: (m[2] as string).trim(), aliases: [] }));
  const byName = new Map(nodes.map((n) => [n.name, n.tempId]));
  const chains = [...text.matchAll(/CHAIN ([^=\n]+)=> ([^\n]+)/g)].map((m) => ({ premises: (m[1] as string).split('+').map((p) => byName.get(p.trim()) ?? p.trim()), conclusion: byName.get((m[2] as string).trim()) ?? '' }));
  return { nodes, chains, conflicts: [] };
}

/** Matcher fixture: same name means the same idea (including unverified guesses). */
function matcher(req: CompleteRequest<unknown>) {
  const text = req.messages[0]?.content ?? '';
  const decisions = text
    .split(/^### /m)
    .slice(1)
    .map((block) => {
      const head = /^(n\d+): ([^(]+) \(/.exec(block);
      const name = head?.[2]?.trim().toLowerCase();
      const hit = [...block.matchAll(/- \[(node_[a-z0-9_]+)\] ([^(]+) \(/g)].find((c) => c[2]?.trim().toLowerCase() === name);
      return { tempId: head?.[1], match: hit?.[1] ?? null, confidence: 0.9, reasoning: 'name' };
    });
  return { decisions };
}

const LECTURE_5 = `# Lecture 5: Differentiable programming

NODE Jacobian matrix: The matrix of all partial derivatives of a vector function.
NODE Jacobian of a composition: The Jacobian of a composition is the product of the Jacobians.
CHAIN Jacobian matrix => Jacobian of a composition
NODE Reverse mode: Reverse mode propagates vector-Jacobian products backwards.
CHAIN Jacobian of a composition => Reverse mode
`;

const LECTURE_4 = `# Lecture 4: Optimization

NODE Gradient descent: Step against the gradient to decrease the loss.
NODE Adam optimizer: Adam scales steps by running estimates of the gradient's moments.
CHAIN Gradient descent => Adam optimizer
`;

const UNRELATED = `# Cooking notes

NODE Maillard reaction: Browning of food from amino acids and sugars reacting under heat.
`;

const EXAM = `Exam 2025, Deep Learning in Physics. 90 minutes, no aids. Problem 1 (20 points): derive the gradient by hand.`;

function setup() {
  const db = openDatabase(':memory:');
  const provider = new FakeProvider({ extractor, matcher });
  const ingestion = new IngestionService({ db, provider, embedder: new FakeEmbedder(), sourcesDir: join(mkdtempSync(join(tmpdir(), 'frontier-goals-')), 'sources') });
  const add = async (title: string, text: string, read = true) => {
    const { source } = await ingestion.addText({ kind: 'markdown', title, text });
    if (read) await ingestion.runSource(source.id);
    return source.id;
  };
  return { db, provider, add };
}

/** Compiler fixture: targets every idea in the material that no capability covers yet, one capability per idea. */
function compiler(req: CompleteRequest<unknown>) {
  const text = req.messages[0]?.content ?? '';
  const ideas = [...(text.split('## Ideas in the goal')[1] ?? '').matchAll(/- \[(node_[a-z0-9_]+)\] ([^(]+) \(/g)].map((m) => ({ id: m[1] as string, name: (m[2] as string).trim() }));
  const existing = text.split('## Existing capabilities')[1]?.split('## Ideas')[0] ?? '';
  const fresh = ideas.filter((i) => !existing.includes(i.id));
  const capabilities = fresh.map((i) => ({ statement: `Can work with ${i.name} in a problem`, targets: [{ ref: i.id, depth: 2 }] }));
  const firstExisting = /- \[(cap_[a-z0-9]+)\]/.exec(existing)?.[1];
  if (ideas.length === 0) {
    // no material: the whole roadmap is expected ideas
    const names = ['Adam optimizer', 'Learning rate schedules', 'Momentum'];
    return {
      title: 'Optimizers',
      capabilities: names.map((name, i) => ({ statement: `Can explain ${name} to a peer`, targets: [{ ref: `m${i + 1}`, depth: 2 }] })),
      newNodes: names.map((name, i) => ({ tempId: `m${i + 1}`, kind: 'term', name, statement: `${name}, as an optimizer idea.` })),
    };
  }
  return {
    title: 'Deep Learning in Physics',
    coverage: existing ? undefined : 'partial',
    capabilities: existing ? capabilities : [...capabilities, { statement: 'Can explain an expected idea', targets: [{ ref: 'm1', depth: 1 }] }],
    extend: firstExisting && fresh[0] ? [{ capabilityId: firstExisting, targets: [{ ref: fresh[0].id, depth: 1 }] }] : [],
    retire: [],
    newNodes: existing ? [] : [{ tempId: 'm1', kind: 'term', name: 'Adam optimizer', statement: 'An adaptive optimizer the course will probably cover.' }],
  };
}

describe('goals v2', () => {
  it('compiles only the goal material, then incrementally: earlier capabilities keep their ids and mastery', async () => {
    const { db, provider, add } = setup();
    provider.script('goalCompiler', compiler);
    const l5 = await add('Lecture 5', LECTURE_5);
    await add('Cooking notes', UNRELATED);
    const goal = createGoal(db, { text: 'Pass Deep Learning in Physics with a 1.0', kind: 'course', assessment: 'written_exam', targetGrade: '1.0', date: '2027-02-12' });
    setMaterials(db, goal.id, [{ sourceId: l5, role: 'teaching' }]);
    expect(nextGoalStep(db, goal.id)).toBe('compile');

    await compileGoal({ db, provider }, goal.id);
    const first = provider.calls.filter((c) => c.role === 'goalCompiler')[0]?.messages[0]?.content ?? '';
    expect(first).toContain('Jacobian of a composition');
    expect(first).not.toContain('Maillard'); // other library material is out of scope
    expect(first).toContain('Assessed by a written exam');
    const before = listCapabilities(db, goal.id);
    expect(before.length).toBe(4);
    expect(getGoal(db, goal.id)?.title).toBe('Deep Learning in Physics');
    markCapabilityMastered(db, before[0]?.id as string);
    const masteredAt = listCapabilities(db, goal.id)[0]?.masteredAt;

    // the compile guessed "Adam optimizer"; it is expected, not taught, while the goal has material
    const detail = goalDetail(db, goal.id);
    expect(detail?.expected.map((e) => e.name)).toEqual(['Adam optimizer']);
    const adamGuess = detail?.expected[0]?.nodeId as string;
    expect(candidatesForGoal(db, goal.id).candidates.map((c) => c.nodeId)).not.toContain(adamGuess);
    startUnverified(db, goal.id, adamGuess);
    expect(candidatesForGoal(db, goal.id).candidates.map((c) => c.nodeId)).toContain(adamGuess);

    // lecture 4 arrives: it grounds the guess and the recompile only adds
    const l4 = await add('Lecture 4', LECTURE_4);
    expect(listNodes(db).find((n) => n.id === adamGuess)?.status).toBe('verified');
    setMaterials(db, goal.id, [
      { sourceId: l5, role: 'teaching' },
      { sourceId: l4, role: 'teaching' },
    ]);
    expect(nextGoalStep(db, goal.id)).toBe('compile');
    await compileGoal({ db, provider }, goal.id);
    const second = provider.calls.filter((c) => c.role === 'goalCompiler')[1]?.messages[0]?.content ?? '';
    expect(second).toContain('## Existing capabilities');
    expect(second).toContain('## Material added since the last compile\n- Lecture 4');
    const after = listCapabilities(db, goal.id);
    expect(after.slice(0, before.length).map((c) => c.id)).toEqual(before.map((c) => c.id));
    expect(after[0]?.masteredAt).toBe(masteredAt);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.map((c) => c.statement)).toContain('Can work with Gradient descent in a problem');
    expect(nextGoalStep(db, goal.id)).toBeNull();
  });

  it('teaches unverified ideas for a goal with no material, or when the learner starts one', async () => {
    const { db, provider } = setup();
    provider.script('goalCompiler', compiler);
    const goal = createGoalFromForm(db, { text: 'Understand optimizers', materials: [] });
    expect(nextGoalStep(db, goal.id)).toBe('compile');
    await compileGoal({ db, provider }, goal.id);
    const adam = goalDetail(db, goal.id)?.expected.find((e) => e.name === 'Adam optimizer')?.nodeId as string;
    expect(candidatesForGoal(db, goal.id).candidates.map((c) => c.nodeId)).toContain(adam);
  });

  it('reads assessment material into an exam profile and guesses roles from content', async () => {
    const { db, provider, add } = setup();
    const exam = await add('Exam_2025', EXAM, false);
    const l5 = await add('Lecture 5', LECTURE_5, false);
    provider.script('extractor', { role: 'assessment', reason: 'A past exam with points per problem.' });
    expect((await guessRole(db, provider, exam)).role).toBe('assessment');
    provider.script('extractor', extractor);

    const goal = createGoalFromForm(db, {
      text: 'Pass Deep Learning in Physics',
      kind: 'course',
      assessment: 'written_exam',
      materials: [
        { sourceId: l5, role: 'teaching' },
        { sourceId: exam, role: 'assessment' },
      ],
    });
    expect(nextGoalStep(db, goal.id)).toBe('read'); // the lecture still needs reading; the exam is never read into ideas
    provider.script('goalCompiler', (req: CompleteRequest<unknown>) => {
      expect(req.messages[0]?.content).toContain('90 minutes, no aids');
      return { examProfile: { summary: 'Written, 90 minutes, no notes. Mostly derivations by hand.', format: 'written, 4 problems', durationMinutes: 90, aids: 'none', questionTypes: ['derive a gradient by hand'], difficulty: 'close to the exercises' }, upcoming: [{ title: 'Lecture 6', expected: '3 November' }] };
    });
    await profileGoal({ db, provider }, goal.id);
    const profiled = getGoal(db, goal.id);
    expect(profiled?.examProfile?.durationMinutes).toBe(90);
    expect(profiled?.coursePlan).toEqual([{ title: 'Lecture 6', expected: '3 November' }]);
    expect(listNodes(db).some((n) => /Exam/.test(n.name))).toBe(false);
  });
});
