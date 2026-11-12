import { describe, expect, it } from 'vitest';
import { buildExaminerSchema } from '../agents/examiner';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { openDatabase } from '../store/db';
import { listEvidenceForNode } from '../store/evidence';
import { addCapabilities, createGoal } from '../store/goals';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { answerDialogue, dialogueView, endDialogue, startDialogue } from './dialogue';
import { recordEvidence } from './evidence';
import { refreshGoalFields } from './knowledge';

const DAY = 86_400_000;

/** Asks until the learner has answered twice or the prompt says to end; then scores every idea. */
function fakeExaminer(score = 7) {
  return (req: CompleteRequest<unknown>) => {
    const text = req.messages[0]?.content ?? '';
    const ids = [...text.matchAll(/^- \[(node_[a-z0-9_]+)\]/gm)].map((m) => m[1] as string);
    const answers = (text.match(/^Learner: /gm) ?? []).length;
    if (text.includes('The conversation ends now') || answers >= 2) {
      return { say: null, done: true, verdict: { summary: 'You gave the reasons, not just the rule.', ideas: ids.map((nodeId) => ({ nodeId, score, note: 'Said why it holds.' })) } };
    }
    return { say: answers === 0 ? 'Why is a Nash equilibrium stable?' : 'And what if one player could move first?', done: false, verdict: null };
  };
}

function setup(script: ConstructorParameters<typeof FakeProvider>[0] = { examiner: fakeExaminer() }, learned = ['bestResponse', 'nash', 'nashMutualBr', 'dominant']) {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const id = (key: string) => ids.get(key) as string;
  const goal = createGoal(db, { text: 'Pass the game theory oral', kind: 'course', assessment: 'oral_exam', date: null, budget: { mode: 'rate', hours: 5, per: 'week', length: 12, lengthUnit: 'weeks' }, targetGrade: null });
  addCapabilities(db, goal.id, [
    { statement: 'Can find Nash equilibria', targets: [{ nodeId: id('nash'), depth: 3 }, { nodeId: id('bestResponse'), depth: 3 }, { nodeId: id('nashMutualBr'), depth: 3 }] },
    { statement: 'Can use dominance', targets: [{ nodeId: id('dominant'), depth: 2 }, { nodeId: id('pdUnique'), depth: 2 }] },
  ]);
  refreshGoalFields(db);
  const now = Date.now();
  // the earlier an idea was learned, the more it has faded
  learned.forEach((key, i) => recordEvidence(db, { nodeId: id(key), kind: 'explain', score: 0.9, reasoning: 'learned', at: new Date(now - (60 - i * 10) * DAY).toISOString() }));
  const provider = new FakeProvider(script);
  return { db, id, goal, provider, deps: { db, provider } };
}

describe('oral exams and teach-backs', () => {
  it('opens on the goal’s learned ideas that have faded most, with the first question', async () => {
    const { id, goal, provider, deps } = setup();
    const view = await startDialogue(deps, goal.id, 'oral');
    expect(view.ideas.map((i) => i.nodeId)).toEqual([id('bestResponse'), id('nash'), id('nashMutualBr')]);
    expect(view.turns).toEqual([{ who: 'examiner', text: 'Why is a Nash equilibrium stable?' }]);
    expect(view.status).toBe('open');
    expect(provider.calls[0]?.role).toBe('examiner');
    // the ideas reach the examiner, and the ones not learned stay out
    expect(provider.calls[0]?.messages[0]?.content).toContain(`[${id('nash')}]`);
    expect(provider.calls[0]?.messages[0]?.content).not.toContain(`[${id('pdUnique')}]`);
  });

  it('is refused before any idea of the goal is learned', async () => {
    const { goal, provider, deps } = setup(undefined, []);
    await expect(startDialogue(deps, goal.id, 'oral')).rejects.toThrow(/Learn a few ideas/);
    expect(provider.calls).toHaveLength(0);
  });

  it('follows up on answers, then scores each idea as practice evidence and closes', async () => {
    const { db, id, goal, deps } = setup();
    const started = await startDialogue(deps, goal.id, 'oral');
    const second = await answerDialogue(deps, started.id, 'Nobody gains by changing alone.');
    expect(second.turns.map((t) => t.who)).toEqual(['examiner', 'learner', 'examiner']);
    expect(second.turns[2]?.text).toMatch(/move first/);

    const done = await answerDialogue(deps, started.id, 'Then it is a sequential game and backward induction applies.');
    expect(done.status).toBe('done');
    expect(done.verdict?.ideas.map((i) => i.nodeId).sort()).toEqual(started.ideas.map((i) => i.nodeId).sort());
    // one direct record per idea (implicit evidence on related ideas follows as for any answer)
    const direct = listEvidenceForNode(db, id('nash')).filter((e) => e.context.dialogueId === started.id);
    expect(direct).toHaveLength(1);
    expect(direct[0]?.kind).toBe('practice');
    expect(direct[0]?.score).toBeCloseTo(0.7);
    expect(direct[0]?.context.step).toBe('oral');
    // an ended conversation takes no more answers
    await expect(answerDialogue(deps, started.id, 'One more thing')).rejects.toThrow(/has ended/);
    expect(dialogueView(db, started.id).status).toBe('done');
  });

  it('counts a teach-back as explaining', async () => {
    const { db, id, goal, deps } = setup();
    const started = await startDialogue(deps, goal.id, 'teach');
    await answerDialogue(deps, started.id, 'Think of it as a truce nobody wants to break.');
    const done = await endDialogue(deps, started.id);
    expect(done.status).toBe('done');
    const direct = listEvidenceForNode(db, id('bestResponse')).filter((e) => e.context.dialogueId === started.id);
    expect(direct.map((e) => [e.kind, e.context.step])).toEqual([['explain', 'teach']]);
  });

  it('ending with nothing said closes it without a verdict or a model call', async () => {
    const { db, id, goal, provider, deps } = setup();
    const started = await startDialogue(deps, goal.id, 'oral');
    const before = listEvidenceForNode(db, id('nash')).length;
    const done = await endDialogue(deps, started.id);
    expect(done.status).toBe('done');
    expect(done.verdict).toBeNull();
    expect(provider.calls).toHaveLength(1);
    expect(listEvidenceForNode(db, id('nash'))).toHaveLength(before);
  });

  it('asks for the verdict once the conversation has run its length', async () => {
    // an examiner that never stops on its own
    const asks = (req: CompleteRequest<unknown>) => {
      const text = req.messages[0]?.content ?? '';
      const ids = [...text.matchAll(/^- \[(node_[a-z0-9_]+)\]/gm)].map((m) => m[1] as string);
      if (text.includes('The conversation ends now')) return { say: null, done: true, verdict: { summary: 'Solid on the core, thin on the edges.', ideas: ids.map((nodeId) => ({ nodeId, score: 6, note: 'Fine.' })) } };
      return { say: 'Go on.', done: false, verdict: null };
    };
    const { goal, provider, deps } = setup({ examiner: asks });
    const started = await startDialogue(deps, goal.id, 'oral');
    let view = started;
    for (let i = 0; i < 8; i += 1) view = await answerDialogue(deps, started.id, `Answer ${i + 1}`);
    expect(view.status).toBe('done');
    expect(provider.calls.at(-1)?.messages[0]?.content).toContain('The conversation ends now');
  });

  it('sends a turn that skips an idea in the verdict back to the model', async () => {
    const { goal, provider, deps } = setup({
      examiner: [
        { say: 'Tell me about best responses.', done: false, verdict: null },
        // the verdict misses two ideas, then gets them all
        { say: null, done: true, verdict: { summary: 'Short but right.', ideas: [] } },
        (req: CompleteRequest<unknown>) => ({ say: null, done: true, verdict: { summary: 'Short but right.', ideas: [...(req.messages[0]?.content ?? '').matchAll(/^- \[(node_[a-z0-9_]+)\]/gm)].map((m) => ({ nodeId: m[1] as string, score: 5, note: 'Brief.' })) } }),
      ],
    });
    const started = await startDialogue(deps, goal.id, 'oral');
    const done = await answerDialogue(deps, started.id, 'The best reply to what the other does.');
    expect(done.verdict?.ideas).toHaveLength(3);
    expect(provider.calls).toHaveLength(2);
  });
});

describe('examiner turn schema', () => {
  const schema = (finish: boolean) => buildExaminerSchema(['node_a', 'node_b'], finish);
  it('needs a question while the conversation goes on', () => {
    expect(schema(false).safeParse({ say: null, done: false, verdict: null }).success).toBe(false);
    expect(schema(false).safeParse({ say: 'Why?', done: false, verdict: null }).success).toBe(true);
  });
  it('needs the verdict, on every idea and only those, when it ends', () => {
    expect(schema(true).safeParse({ say: 'Why?', done: false, verdict: null }).success).toBe(false);
    expect(schema(true).safeParse({ say: null, done: true, verdict: null }).success).toBe(false);
    const ideas = [
      { nodeId: 'node_a', score: 8, note: 'Clear.' },
      { nodeId: 'node_c', score: 4, note: 'Unsure.' },
    ];
    expect(schema(true).safeParse({ say: null, done: true, verdict: { summary: 'Mostly there.', ideas } }).success).toBe(false);
    expect(schema(true).safeParse({ say: null, done: true, verdict: { summary: 'Mostly there.', ideas: [ideas[0], { ...ideas[1], nodeId: 'node_b' }] } }).success).toBe(true);
  });
});
