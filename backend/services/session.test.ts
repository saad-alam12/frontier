import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { FakeEmbedder } from '../ingest/embedder';
import { openDatabase } from '../store/db';
import { createGoal, addCapabilities } from '../store/goals';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { getState, listEvidenceForSession } from '../store/evidence';
import { listBugsForNode } from '../store/bugs';
import { activeSession, listSessionEvents, listSessions } from '../store/sessions';
import { listSources } from '../store/sources';
import { IngestionService } from './ingestion';
import { refreshGoalFields } from './knowledge';
import { recordEvidence } from './evidence';
import { abandonSession, cancelRespond, currentSession, pauseSession, respond, startSession } from './session';
import { settleGrading } from './practice';
import type { SessionState } from './session';

/** A tutor that answers any stage with a plausible card and grades from a queue of scores. */
function fakeTutor(scores: number[]) {
  const queue = [...scores];
  return (req: CompleteRequest<unknown>) => {
    const text = req.messages[0]?.content ?? '';
    if (req.submit.name === 'submit_recall') {
      const ids = [...text.matchAll(/- \[(node_[a-z0-9_]+)\]/g)].map((m) => m[1]);
      const closing = /add the closing summary/.test(text);
      return { recalled: ids.map((id) => ({ nodeId: id, score: 0.8, note: '' })), canDo: closing ? 'You can now find equilibria.' : null, previewQuestion: closing ? 'What changes if payoffs double?' : null };
    }
    const grading = /Grade the response/.test(text);
    const stage = /Produce the \*\*(\w+)\*\* card|produce the \*\*(\w+)\*\* card/.exec(text);
    const next = stage?.[1] ?? stage?.[2] ?? null;
    const score = grading ? (queue.shift() ?? 0.8) : null;
    const grade = grading ? { score, feedback: `Scored ${score}.`, misconception: score !== null && score < 0.3 ? 'Thinks equilibrium means best for all.' : null, confidentlyWrong: false } : null;
    const cards: Record<string, unknown> = {
      predict: { stage: 'predict', prompt: 'What would make a profile stable?' },
      explain: { stage: 'explain', markdown: '## The idea\n\nNo one gains by moving alone, so $u_i(s) \\ge u_i(s_i\', s_{-i})$.' },
      check: { stage: 'check', question: 'Is (A,B) stable here?', answerKey: 'Yes', rubric: ['says yes', 'checks deviations'] },
      derive: { stage: 'derive', prompt: 'Rebuild it from best responses.', answerKey: 'mutual BR', rubric: ['uses BR'] },
      connect: { stage: 'connect', prompt: 'State one link.' },
      compress: { stage: 'compress', prompt: 'Your own words, two sentences.' },
      use: { stage: 'use', task: 'Find the equilibrium of this game; and say why this other one has none in pure strategies.', answerKey: '(A,B)', rubric: ['finds it', 'explains the no case'] },
      index: { stage: 'index', gist: 'A profile is a list of strategies.', placement: 'It sits under Nash.', question: 'What is a profile?', answerKey: 'one strategy per player' },
      support: { stage: 'support', markdown: 'Worked example: ...' },
      reteach: { stage: 'reteach', markdown: 'You have been reading it as the best outcome for all; it is about one player at a time.' },
    };
    return { grade, card: next ? cards[next] : null };
  };
}

async function setup(scores: number[] = []) {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const own = (key: string) => recordEvidence(db, { nodeId: ids.get(key) as string, kind: 'explain', score: 0.95, reasoning: 't' });
  for (const key of ['strategy', 'payoff']) own(key);
  const goal = createGoal(db, 'Pass the game theory exam');
  addCapabilities(db, goal.id, [
    { statement: 'Can find Nash equilibria', targets: [{ nodeId: ids.get('nash') as string, depth: 3 }, { nodeId: ids.get('profile') as string, depth: 1 }, { nodeId: ids.get('bestResponse') as string, depth: 2 }] },
    { statement: 'Can explain dominance', targets: [{ nodeId: ids.get('dominant') as string, depth: 2 }, { nodeId: ids.get('dominantNash') as string, depth: 3 }] },
  ]);
  refreshGoalFields(db);
  const tutor = fakeTutor(scores);
  const provider = new FakeProvider({ tutor, tutorEscalation: tutor });
  provider.script('planner', (req: CompleteRequest<unknown>) => {
    const text = (req.messages[0]?.content ?? '').split('## Candidates')[1] ?? '';
    const all = [...text.matchAll(/- \[(node_[a-z0-9_]+)\] ([^(]+) \(/g)].map((m) => ({ id: m[1] as string, name: (m[2] as string).trim() }));
    const preferred = all.filter((c) => ['Strategy profile', 'Best response', 'Nash equilibrium'].includes(c.name));
    const picks = (preferred.length ? preferred : all.slice(0, 3)).map((c) => c.id);
    return { title: 'Profiles and best responses', orientation: 'Today builds Nash equilibrium from the two ideas it is made of.', steps: picks.map((nodeId) => ({ nodeId, why: 'needed for the exam' })) };
  });
  provider.script('extractor', { nodes: [], chains: [], conflicts: [] });
  provider.script('matcher', { decisions: [] });
  const ingestion = new IngestionService({ db, provider, embedder: new FakeEmbedder(), sourcesDir: join(mkdtempSync(join(tmpdir(), 'frontier-sess-')), 'sources') });
  return { db, ids, goal, provider, deps: { db, provider, ingestion } };
}

const answer = (text: string, confidence = 0.66) => ({ answer: text, confidence });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('stopping an answer (Esc)', () => {
  it('stops the tutor before anything is written, and the edited answer goes through', async () => {
    const { db, goal, deps } = await setup([0.8, 0.8, 0.8]);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    expect(snap.current?.stage).toBe('index');
    const events = listSessionEvents(db, snap.id).length;
    const evidence = listEvidenceForSession(db, snap.id).length;

    const tutor = fakeTutor([0.8, 0.8]);
    deps.provider.script('tutor', (req: CompleteRequest<unknown>) => new Promise(() => void req), tutor);
    const first = respond(deps, snap.id, answer('first try'));
    await settle();
    await expect(respond(deps, snap.id, answer('impatient'))).rejects.toThrow('Still working');
    expect(cancelRespond(snap.id)).toBe(true);
    await expect(first).rejects.toThrow('cancelled');
    expect(listSessionEvents(db, snap.id)).toHaveLength(events);
    expect(listEvidenceForSession(db, snap.id)).toHaveLength(evidence);
    expect(currentSession(db)?.current?.stage).toBe('index');
    expect(currentSession(db)?.card).toEqual(snap.card);

    snap = await respond(deps, snap.id, answer('second try'));
    expect(snap.history.nodes[0]?.items[0]?.response?.answer).toBe('second try');
    expect(listEvidenceForSession(db, snap.id)).toHaveLength(evidence + 1);
    expect(cancelRespond(snap.id)).toBe(false); // nothing in flight
  });

  it('cannot stop once the tutor has answered: the request runs to the end', async () => {
    const { goal, deps } = await setup([0.8]);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    let release: () => void = () => undefined;
    const tutor = fakeTutor([0.8, 0.8]);
    let calls = 0;
    deps.provider.script('tutor', (req: CompleteRequest<unknown>) => {
      calls += 1;
      // the first call answers; the second (the next idea's first card) waits
      return calls === 1 ? tutor(req) : new Promise((resolve) => (release = () => resolve(tutor(req))));
    });
    const pending = respond(deps, snap.id, answer('one strategy per player'));
    await settle();
    expect(cancelRespond(snap.id)).toBe(false);
    release();
    snap = await pending;
    expect(snap.history.nodes[0]?.status).toBe('done');
  });
});

describe('teaching session', () => {
  it('runs a node through the step loop, writing evidence, own words and bugs', async () => {
    const { db, ids, goal, deps } = await setup([0.8, 0.8, 0.9, 0.2, 0.7, 0.7, 0.8, 0.85]);
    let snap = await startSession(deps, goal.id);
    expect(snap.phase).toBe('orient'); // no previous session: no reconstruct
    expect(snap.plan.steps.map((s) => s.name)).toEqual(['Strategy profile', 'Best response', 'Nash equilibrium']);
    expect(snap.plan.steps.map((s) => s.mode)).toEqual(['index', 'index', 'derive']);
    snap = await respond(deps, snap.id, answer(''));
    expect(snap.phase).toBe('teach');
    expect(snap.current?.stage).toBe('index');
    const brId = ids.get('nash') as string;

    // index passes for the two terms, then the full loop on Nash
    const walk = async (text: string) => (snap = await respond(deps, snap.id, answer(text)));
    while (snap.phase === 'teach' && snap.current?.nodeId !== brId) await walk('one strategy per player');
    expect(getState(db, ids.get('profile') as string)?.depth).toBe(1);
    expect(snap.current?.stage).toBe('predict');
    expect(JSON.stringify(snap.card)).not.toContain('answerKey');
    await walk('the move that pays best given the others');
    expect(snap.current?.stage).toBe('explain');
    expect(snap.history.nodes.find((n) => n.nodeId === brId)?.items.at(-1)?.grade?.score).toBe(0.9);
    snap = await respond(deps, snap.id, { answer: '', effort: 2 });
    expect(snap.current?.stage).toBe('check');
    await walk('no idea'); // 0.2 → misconception recorded
    expect(snap.current?.stage).toBe('derive');
    expect(listBugsForNode(db, brId)).toHaveLength(1);
    await walk('mutual best responses'); // 0.7
    expect(snap.current?.stage).toBe('connect');
    await walk('this requires payoffs'); // 0.7 → link kept for the transcript
    expect(snap.current?.stage).toBe('compress');
    snap = await respond(deps, snap.id, { answer: 'The reply that pays most given what the others do.', handle: 'best reply' });
    expect(snap.current?.stage).toBe('use');
    expect(getState(db, brId)?.ownStatement).toBe('The reply that pays most given what the others do.');
    expect(getState(db, brId)?.handle).toBe('best reply');
    await walk('(A,B); the other game has a cycle'); // 0.85 → node done
    // the conversation so far: every earlier card, the answer exactly as given and its rating, rebuilt from events
    const restored = currentSession(db);
    expect(restored?.history.nodes.map((n) => n.name)).toEqual(['Strategy profile', 'Best response', 'Nash equilibrium']);
    expect(restored?.history.nodes.slice(0, 2).every((n) => n.status === 'done' && n.score !== null)).toBe(true);
    const nashItems = restored?.history.nodes[2]?.items ?? [];
    expect(nashItems.map((h) => h.stage)).toEqual(['predict', 'explain', 'check', 'derive', 'connect', 'compress', 'use']);
    expect(nashItems[0]?.response?.answer).toBe('the move that pays best given the others');
    expect(nashItems[0]?.grade?.feedback).toBe('Scored 0.9.');
    expect(nashItems[2]?.card).toEqual({ stage: 'check', question: 'Is (A,B) stable here?' });
    expect(JSON.stringify(restored?.history)).not.toContain('answerKey');
    const evidence = listEvidenceForSession(db, snap.id).filter((e) => e.nodeId === brId);
    expect(evidence.map((e) => e.kind).sort()).toEqual(['check', 'derive', 'explain', 'predict', 'use'].sort());
    expect(evidence.find((e) => e.kind === 'check')?.effort).toBe(2);
    expect(getState(db, brId)?.depth).toBe(4);
  });

  it('resumes at the same card after a restart and closes with recall, preview and transcript ingestion', async () => {
    const { db, goal, deps } = await setup([0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8]);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    const callsBefore = deps.provider.calls.length;
    pauseSession(db, snap.id);
    const before = currentSession(db);
    expect(before?.id).toBe(snap.id);
    expect(before?.status).toBe('active');
    expect(before?.card).toEqual(snap.card);
    expect(before?.current?.stage).toBe(snap.current?.stage);
    expect(await startSession(deps, goal.id)).toEqual(before); // resuming regenerates nothing
    expect(deps.provider.calls.length).toBe(callsBefore);

    let guard = 0;
    while (snap.phase === 'teach' && guard++ < 40) snap = await respond(deps, snap.id, answer('an answer', 0.7));
    expect(snap.phase).toBe('close');
    expect(snap.plan.steps.every((s) => s.status === 'done')).toBe(true);
    snap = await respond(deps, snap.id, answer('profiles list a strategy per player; best responses maximize payoff'));
    expect(snap.phase).toBe('preview');
    expect(snap.closing?.previewQuestion).toBe('What changes if payoffs double?');
    expect(snap.closing?.recall.length).toBe(3);
    snap = await respond(deps, snap.id, answer(''));
    expect(snap.phase).toBe('done');
    expect(snap.status).toBe('done');
    expect(activeSession(db)).toBeUndefined();
    const recall = listEvidenceForSession(db, snap.id).filter((e) => e.kind === 'recall');
    expect(recall).toHaveLength(3);
    const transcripts = listSources(db).filter((s) => s.kind === 'session');
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0]?.title).toMatch(/^Session \d{4}-\d{2}-\d{2}: Profiles and best responses$/);
    const kinds = listSessionEvents(db, snap.id).map((e) => e.kind);
    expect(kinds[0]).toBe('start');
    expect(kinds).toContain('card');
    expect(kinds).toContain('node-done');
    expect(kinds[kinds.length - 1]).toBe('transcript');

    // a second session on the same goal opens with reconstruction of what was taught
    const again = await startSession(deps, goal.id);
    expect(again.phase).toBe('reconstruct');
    expect(again.previousNodes.map((n) => n.name).sort()).toEqual(['Best response', 'Nash equilibrium', 'Strategy profile']);
    const after = await respond(deps, again.id, answer('a profile is one strategy per player'));
    expect(after.phase).toBe('orient');
    expect(listEvidenceForSession(db, again.id).filter((e) => e.kind === 'recall')).toHaveLength(3);
    await abandonSession(deps, again.id);
    expect(listSessions<SessionState>(db).find((s) => s.id === again.id)?.status).toBe('abandoned');
  });

  it('ending a session keeps the place: the next one recalls finished ideas and continues the half-done one', async () => {
    const { db, ids, goal, deps } = await setup([0.8, 0.8, 0.9, 0.8]);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    const nashId = ids.get('nash') as string;
    while (snap.phase === 'teach' && snap.current?.nodeId !== nashId) snap = await respond(deps, snap.id, answer('one strategy per player'));
    snap = await respond(deps, snap.id, answer('the move that pays best given the others')); // predict → explain
    snap = await respond(deps, snap.id, { answer: '', effort: 3 }); // explain read → check
    expect(snap.current?.stage).toBe('check');
    const openCard = snap.card;
    await abandonSession(deps, snap.id);
    expect(listSources(db).filter((s) => s.kind === 'session')).toHaveLength(1); // transcript ingested on end too

    const next = await startSession(deps, goal.id);
    expect(next.id).not.toBe(snap.id);
    expect(next.phase).toBe('reconstruct');
    expect(next.previousNodes.map((n) => n.name).sort()).toEqual(['Best response', 'Strategy profile']);
    expect(next.plan.steps[0]?.nodeId).toBe(nashId);
    const carried = next.history.nodes.find((n) => n.nodeId === nashId);
    expect(carried?.items.map((h) => [h.stage, h.response?.answer, h.carried])).toEqual([
      ['predict', 'the move that pays best given the others', true],
      ['explain', '', true],
    ]);
    let after = await respond(deps, next.id, answer('profiles and best replies'));
    expect(after.phase).toBe('orient');
    const callsBefore = deps.provider.calls.length;
    after = await respond(deps, next.id, answer(''));
    expect(deps.provider.calls.length).toBe(callsBefore); // the open card comes back, nothing regenerated
    expect(after.current?.nodeId).toBe(nashId);
    expect(after.current?.stage).toBe('check');
    expect(after.card).toEqual(openCard);
    after = await respond(deps, next.id, answer('yes, nobody gains by moving alone'));
    expect(after.current?.stage).toBe('derive');
    const items = after.history.nodes.find((n) => n.nodeId === nashId)?.items ?? [];
    expect(items.map((h) => h.stage)).toEqual(['predict', 'explain', 'check']);
    expect(items[2]?.carried).toBe(true);
    expect(items[2]?.response?.answer).toBe('yes, nobody gains by moving alone');
    expect(listEvidenceForSession(db, next.id).find((e) => e.kind === 'check')?.effort).toBe(3);

    // ending again carries it again, with everything said so far
    await abandonSession(deps, next.id);
    const third = await startSession(deps, goal.id);
    expect(third.plan.steps[0]?.nodeId).toBe(nashId);
    expect(third.history.nodes.find((n) => n.nodeId === nashId)?.items.map((h) => h.stage)).toEqual(['predict', 'explain', 'check']);
    expect(third.plan.steps.filter((s) => s.nodeId === nashId)).toHaveLength(1);
  });

  it('runs compound practice on fading ideas after the last idea, then closes', async () => {
    const { db, ids, goal, provider, deps } = await setup([0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8]);
    const longAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();
    recordEvidence(db, { nodeId: ids.get('dominant') as string, kind: 'explain', score: 0.9, reasoning: 'learned long ago', at: longAgo });
    provider.script('problemGenerator', (req: CompleteRequest<unknown>) => {
      const count = [...(req.messages[0]?.content ?? '').matchAll(/### Problem (\d+)/g)].length;
      return { problems: Array.from({ length: count }, (_, index) => ({ index, statement: `Which strategy would you never regret playing here? Payoffs ... (${index})`, solution: 'The one that beats every other whatever the opponent does.', rubric: ['names it', 'checks every column'] })) };
    });
    provider.script('grader', (req: CompleteRequest<unknown>) => {
      const nodeIds = [...(req.messages[0]?.content ?? '').matchAll(/- \[(node_[a-z0-9_]+)\]/g)].map((m) => m[1] as string);
      return { score: 7, feedback: 'Good.', ideas: nodeIds.map((nodeId) => ({ nodeId, score: 7 })), misconception: null };
    });
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    let guard = 0;
    while (snap.phase === 'teach' && guard++ < 40) snap = await respond(deps, snap.id, answer('an answer', 0.7));
    expect(snap.phase).toBe('practice');
    expect(snap.practice?.problems).toHaveLength(1);
    expect(snap.practice?.problems[0]?.solution).toBeNull();
    snap = await respond(deps, snap.id, answer('the dominant one', 0.66));
    expect(snap.phase).toBe('practice');
    expect(snap.practiceRevealed).toBe(snap.practice?.problems[0]?.id);
    expect(snap.practice?.problems[0]?.solution).toContain('beats every other');
    await settleGrading();
    expect(currentSession(db)?.practice?.problems[0]?.grade?.score).toBe(7);
    const practised = listEvidenceForSession(db, snap.id).filter((e) => e.kind === 'practice' && !e.context.implicit);
    expect(practised.map((e) => e.nodeId)).toEqual([ids.get('dominant')]);
    snap = await respond(deps, snap.id, answer(''));
    expect(snap.phase).toBe('close');
  });

  it('drops to a worked example after three failures and skips ahead after easy successes', async () => {
    const { ids, goal, deps } = await setup([0.5, 0.5, 0.1, 0.1, 0.1, 0.95, 0.95, 0.9]);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    const nashId = ids.get('nash') as string;
    while (snap.phase === 'teach' && snap.current?.nodeId !== nashId) snap = await respond(deps, snap.id, answer('x'));
    // the index passes consumed two scores; Nash: predict 0.1, check 0.1, derive 0.1 → support
    snap = await respond(deps, snap.id, answer('wrong'));
    expect(snap.current?.stage).toBe('explain');
    snap = await respond(deps, snap.id, answer(''));
    expect(snap.current?.stage).toBe('check');
    snap = await respond(deps, snap.id, answer('wrong again'));
    expect(snap.current?.stage).toBe('derive');
    snap = await respond(deps, snap.id, answer('still wrong'));
    expect(snap.current?.stage).toBe('support');
    snap = await respond(deps, snap.id, answer(''));
    expect(snap.current?.stage).toBe('connect'); // resumes after the stage that triggered support
    snap = await respond(deps, snap.id, answer('this requires payoffs')); // 0.95
    expect(snap.current?.stage).toBe('compress');
    snap = await respond(deps, snap.id, answer('own words')); // 0.95 → skip ahead; compress is the last before use, so use follows
    expect(snap.current?.stage).toBe('use');
  });

  it('escalates to a fresh explanation from the escalation model when the learner fails after a worked example', async () => {
    const { ids, goal, deps } = await setup([0.5, 0.5, 0.1, 0.1, 0.1, 0.2, 0.8]);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    const nashId = ids.get('nash') as string;
    while (snap.phase === 'teach' && snap.current?.nodeId !== nashId) snap = await respond(deps, snap.id, answer('x'));
    snap = await respond(deps, snap.id, answer('wrong')); // predict 0.1
    snap = await respond(deps, snap.id, answer('')); // explain read
    snap = await respond(deps, snap.id, answer('wrong')); // check 0.1
    snap = await respond(deps, snap.id, answer('wrong')); // derive 0.1 → worked example
    expect(snap.current?.stage).toBe('support');
    snap = await respond(deps, snap.id, answer(''));
    expect(snap.current?.stage).toBe('connect');
    const before = deps.provider.calls.length;
    snap = await respond(deps, snap.id, answer('still lost')); // connect 0.2 → escalate
    expect(snap.current?.stage).toBe('reteach');
    expect(deps.provider.calls.slice(before).map((c) => c.role)).toContain('tutorEscalation');
    snap = await respond(deps, snap.id, answer(''));
    expect(snap.current?.stage).toBe('compress'); // resumes after the stage that failed
  });
});
