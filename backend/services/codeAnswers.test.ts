import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { saveImageFile } from '../store/attachments';
import { openDatabase } from '../store/db';
import { addCapabilities, createGoal } from '../store/goals';
import { answerFor, listProblems } from '../store/practice';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { SettingsPatchSchema, SettingsSchema, salvageSettings } from '../settings/schema';
import { recordEvidence } from './evidence';
import { refreshGoalFields } from './knowledge';
import { settleGrading, startPractice, submitPracticeAnswer } from './practice';
import { respond, startSession } from './session';
import { SessionWork } from './sessionWork';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function world() {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  for (const key of ['strategy', 'payoff']) recordEvidence(db, { nodeId: ids.get(key) as string, kind: 'explain', score: 0.95, reasoning: 't' });
  const attachmentsDir = join(mkdtempSync(join(tmpdir(), 'frontier-code-answers-')), 'attachments');
  return { db, ids, attachmentsDir };
}

describe('code in answers (B19)', () => {
  it('a question can ask for code with a starter, and the tutor reads the code, its output and its plots', async () => {
    const { db, ids, attachmentsDir } = world();
    const profile = ids.get('profile') as string;
    const goal = createGoal(db, 'Simulate games in Python');
    addCapabilities(db, goal.id, [{ statement: 'Can list profiles', targets: [{ nodeId: profile, depth: 2 }] }]);
    refreshGoalFields(db);
    const seen: CompleteRequest<unknown>[] = [];
    const tutor = (req: CompleteRequest<unknown>) => {
      seen.push(req);
      const text = req.messages[0]?.content ?? '';
      const next = /roduce the \*\*(\w+)\*\* card/.exec(text)?.[1];
      const grade = /Grade the response/.test(text) ? { score: 0.9, feedback: 'Right.', misconception: null, confidentlyWrong: false, missingBackground: null } : null;
      const cards: Record<string, unknown> = {
        predict: { stage: 'predict', prompt: 'How many profiles has a 2 × 3 game?' },
        explain: { stage: 'explain', markdown: 'One strategy per player.' },
        check: { stage: 'check', question: 'Write code that lists every profile of a 2 × 3 game.', answerKey: 'six pairs', rubric: ['uses a product', 'prints six'], code: { language: 'python', starter: 'from itertools import product\n' } },
        compress: { stage: 'compress', prompt: 'Your own words.' },
      };
      return { grade, card: next ? cards[next] : null };
    };
    const provider = new FakeProvider({ planner: () => ({ title: 'Profiles', orientation: 'Today we list profiles.', steps: [{ nodeId: profile, why: 'needed' }] }), tutor });
    const deps = { db, provider, work: new SessionWork(), attachmentsDir };
    let snap = await startSession(deps, goal.id);
    for (let i = 0; i < 4 && snap.card?.stage !== 'check'; i += 1) snap = await respond(deps, snap.id, { answer: 'six', confidence: 0.33 });
    expect(snap.card).toEqual({ stage: 'check', question: 'Write code that lists every profile of a 2 × 3 game.', code: { language: 'python', starter: 'from itertools import product\n' } });

    // a run whose plot was never stored is refused before anything reaches the model
    const unsaved = { language: 'python' as const, source: 'print(6)', run: { exitCode: 0, stdout: '6\n', stderr: '', timedOut: false, plots: [`${'0'.repeat(64)}.png`] } };
    await expect(respond(deps, snap.id, { answer: '', code: unsaved })).rejects.toThrow('An attached image was not saved');

    const plot = saveImageFile(attachmentsDir, PNG, 'image/png');
    const source = 'from itertools import product\nprint(len(list(product("AB", "xyz"))))';
    snap = await respond(deps, snap.id, { answer: '', confidence: 0.66, code: { language: 'python', source, run: { exitCode: 0, stdout: '6\n', stderr: '', timedOut: false, plots: [plot] } } });
    const graded = seen[seen.length - 1];
    const text = graded?.messages[0]?.content ?? '';
    expect(text).toContain('(no text: the answer is the code below)');
    expect(text).toContain(`\`\`\`python\n${source}\n\`\`\``);
    expect(text).toContain('The learner ran it; it finished without an error.');
    expect(text).toContain('Output:\n```\n6\n```');
    expect(graded?.messages[0]?.images).toHaveLength(1); // the plot
    const sent = snap.history.nodes[0]?.items.find((item) => item.stage === 'check')?.response;
    expect(sent?.code?.source).toBe(source);
  });

  it('a practice answer keeps its code, and the grader reads it with its plots, even with no text', async () => {
    const { db, ids, attachmentsDir } = world();
    const nash = ids.get('nash') as string;
    const goal = createGoal(db, 'Simulate games in Python');
    addCapabilities(db, goal.id, [{ statement: 'Can find equilibria', targets: [{ nodeId: nash, depth: 3 }] }]);
    refreshGoalFields(db);
    recordEvidence(db, { nodeId: nash, kind: 'explain', score: 0.9, reasoning: 'learned', at: new Date(Date.now() - 60 * 86_400_000).toISOString() });
    const graded: CompleteRequest<unknown>[] = [];
    const provider = new FakeProvider({
      problemGenerator: (req: CompleteRequest<unknown>) => {
        const specs = [...(req.messages[0]?.content ?? '').matchAll(/### Problem (\d+)/g)].map((m) => Number(m[1]));
        return { problems: specs.map((index) => ({ index, statement: 'Write code that finds the pure equilibria of the game with payoffs (3,3), (0,5), (5,0), (1,1).', solution: 'Check each cell for a profitable deviation.', rubric: ['checks deviations', 'finds (1,1)'], code: { language: 'python', starter: 'payoffs = {}\n' } })) };
      },
      grader: (req: CompleteRequest<unknown>) => {
        graded.push(req);
        const ideas = [...(req.messages[0]?.content ?? '').matchAll(/- \[(node_[a-z0-9_]+)\]/g)].map((m) => ({ nodeId: m[1] as string, score: 8 }));
        return { score: 8, feedback: 'Works.', ideas, misconception: null };
      },
    });
    const deps = { db, provider, attachmentsDir };
    const set = await startPractice(deps, goal.id, { focus: { nodeIds: [nash] } });
    const problem = set?.problems[0];
    expect(problem?.code).toEqual({ language: 'python', starter: 'payoffs = {}\n' });
    const plot = saveImageFile(attachmentsDir, PNG, 'image/png');
    const code = { language: 'python' as const, source: 'print([(1, 1)])', run: { exitCode: 0, stdout: '[(1, 1)]\n', stderr: '', timedOut: false, plots: [plot] } };
    const view = submitPracticeAnswer(deps, problem?.id ?? '', '', null, { code });
    expect(view.problems[0]?.answer?.code).toEqual(code);
    await settleGrading();
    expect(graded).toHaveLength(1); // code with no text is an answer, not "no idea"
    expect(graded[0]?.messages[0]?.content).toContain('```python\nprint([(1, 1)])\n```');
    expect(graded[0]?.messages[0]?.images).toHaveLength(1);
    const stored = answerFor(db, listProblems(db, set?.id ?? '')[0]?.id ?? '');
    expect(stored?.extras.code?.source).toBe('print([(1, 1)])');
    expect(stored?.score).toBeCloseTo(0.8);
  });

  it('Settings keep the Python path, also when another field of the file is broken', () => {
    expect(SettingsSchema.parse({}).pythonPath).toBe('');
    expect(SettingsPatchSchema.parse({ pythonPath: '/opt/homebrew/bin/python3' })).toEqual({ pythonPath: '/opt/homebrew/bin/python3' });
    expect(salvageSettings({ pythonPath: '/usr/local/bin/python3', concurrency: 'many' }).pythonPath).toBe('/usr/local/bin/python3');
  });
});
