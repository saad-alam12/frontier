import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { FakeEmbedder } from '../ingest/embedder';
import { openDatabase } from '../store/db';
import { addCapabilities, capTargets, createGoal, getGoal, listTargets } from '../store/goals';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { getState, listEvidenceForSession } from '../store/evidence';
import { listBugsForNode } from '../store/bugs';
import { activeSession, getSession, listSessionEvents, listSessions } from '../store/sessions';
import { logTime } from '../store/activity';
import { listSources } from '../store/sources';
import { saveAttachment } from '../store/attachments';
import { getDrafts, setDraft } from '../store/drafts';
import { IngestionService } from './ingestion';
import { refreshGoalFields } from './knowledge';
import { deeperMinutes, goDeeper } from './goals';
import { recordEvidence } from './evidence';
import { abandonSession, askTutor, currentSession, pauseSession, respond, startSession } from './session';
import { trail } from './trails';
import { SessionWork } from './sessionWork';
import { settleGrading } from './practice';
import type { SessionState } from './session';
import type { Grade } from '../agents/tutor';
import type { IdeaFinished } from '../core/cards';
import { reviewsByCard } from '../store/cards';
import { saveCard } from './cards';
import { stageAsked } from '../llm/fakeTutor';

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
    const score = grading ? (queue.shift() ?? 0.8) : null;
    const next = stageAsked(text, score);
    const said = text.split("## Learner's response")[1] ?? '';
    const missingBackground = /never heard of/.test(said) ? { name: 'best responses', hours: 2 } : null;
    const grade = grading ? { score, feedback: `Scored ${score}.`, misconception: score !== null && score < 0.3 ? 'Thinks equilibrium means best for all.' : null, confidentlyWrong: false, missingBackground } : null;
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

/** A planner that picks profiles, best responses and Nash equilibrium when they are candidates. */
function fakePlanner(req: CompleteRequest<unknown>) {
  const text = (req.messages[0]?.content ?? '').split('## Candidates')[1] ?? '';
  const all = [...text.matchAll(/- \[(node_[a-z0-9_]+)\] ([^(]+) \(/g)].map((m) => ({ id: m[1] as string, name: (m[2] as string).trim() }));
  const preferred = all.filter((c) => ['Strategy profile', 'Best response', 'Nash equilibrium'].includes(c.name));
  const picks = (preferred.length ? preferred : all.slice(0, 3)).map((c) => c.id);
  return { title: 'Profiles and best responses', orientation: 'Today builds Nash equilibrium from the two ideas it is made of.', steps: picks.map((nodeId) => ({ nodeId, why: 'needed for the exam' })) };
}

async function setup(scores: number[] = [], extra: { key: string; depth: 1 | 2 | 3 | 4 }[] = [], planner: (req: CompleteRequest<unknown>) => unknown = fakePlanner) {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const own = (key: string) => recordEvidence(db, { nodeId: ids.get(key) as string, kind: 'explain', score: 0.95, reasoning: 't' });
  for (const key of ['strategy', 'payoff']) own(key);
  const goal = createGoal(db, 'Pass the game theory exam');
  addCapabilities(db, goal.id, [
    { statement: 'Can find Nash equilibria', targets: [{ nodeId: ids.get('nash') as string, depth: 3 }, { nodeId: ids.get('profile') as string, depth: 1 }, { nodeId: ids.get('bestResponse') as string, depth: 1 }] },
    { statement: 'Can explain dominance', targets: [{ nodeId: ids.get('dominant') as string, depth: 2 }, { nodeId: ids.get('dominantNash') as string, depth: 3 }] },
    ...(extra.length ? [{ statement: 'Can use it', targets: extra.map((e) => ({ nodeId: ids.get(e.key) as string, depth: e.depth })) }] : []),
  ]);
  refreshGoalFields(db);
  const tutor = fakeTutor(scores);
  const provider = new FakeProvider({ tutor, tutorEscalation: tutor });
  provider.script('planner', planner);
  provider.script('extractor', { nodes: [], chains: [], conflicts: [] });
  provider.script('matcher', { decisions: [] });
  const ingestion = new IngestionService({ db, provider, embedder: new FakeEmbedder(), sourcesDir: join(mkdtempSync(join(tmpdir(), 'frontier-sess-')), 'sources') });
  const work = new SessionWork();
  return { db, ids, goal, provider, work, deps: { db, provider, ingestion, work } };
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
    expect(deps.work.cancel(snap.id)).toBe(true);
    await expect(first).rejects.toThrow('cancelled');
    expect(listSessionEvents(db, snap.id)).toHaveLength(events);
    expect(listEvidenceForSession(db, snap.id)).toHaveLength(evidence);
    expect(currentSession(db)?.current?.stage).toBe('index');
    expect(currentSession(db)?.card).toEqual(snap.card);

    snap = await respond(deps, snap.id, answer('second try'));
    expect(snap.history.nodes[0]?.items[0]?.response?.answer).toBe('second try');
    expect(listEvidenceForSession(db, snap.id)).toHaveLength(evidence + 1);
    expect(deps.work.cancel(snap.id)).toBe(false); // nothing in flight
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
    expect(deps.work.cancel(snap.id)).toBe(false);
    release();
    snap = await pending;
    expect(snap.history.nodes[0]?.status).toBe('done');
  });
});

describe('work that keeps going when the Session screen closes', () => {
  /** Hold the tutor's next call open until `release` is called. */
  function holdTutor(deps: Awaited<ReturnType<typeof setup>>['deps'], fail = false) {
    let release: () => void = () => undefined;
    const tutor = fakeTutor([0.8, 0.8, 0.8]);
    deps.provider.script('tutor', (req: CompleteRequest<unknown>) => new Promise((resolve, reject) => (release = () => (fail ? reject(new Error('tutor: the model ended without calling the submit tool')) : resolve(tutor(req))))), tutor);
    return () => release();
  }

  it('shows an answer still being judged in the snapshot, as sent, and announces when it is done', async () => {
    const { db, goal, deps } = await setup([0.8, 0.8]);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    const card = snap.card;
    const events: string[] = [];
    deps.work.subscribe((e) => events.push(`${e.kind}:${e.outcome}${e.work?.stoppable ? ' (stoppable)' : ''}`));
    const release = holdTutor(deps);
    const pending = respond(deps, snap.id, { ...answer('one strategy per player'), quote: 'A profile' }, { draftKey: `session:${snap.id}:card` });
    await settle();

    // the screen closed and opened again: it reads the answer as it was sent, still stoppable
    const reopened = currentSession(db, deps.work);
    expect(reopened?.work).toMatchObject({ kind: 'respond', status: 'running', sessionId: snap.id, stoppable: true, error: null });
    expect(reopened?.work?.sent).toEqual({ card, stage: 'index', response: { answer: 'one strategy per player', confidence: 0.66, quote: 'A profile' } });
    expect(deps.work.current()?.sessionId).toBe(snap.id);
    expect(events).toEqual(['respond:running (stoppable)']);

    release();
    snap = await pending;
    // once the tutor has answered, the answer can no longer be stopped; then the next card is there
    expect(events).toEqual(['respond:running (stoppable)', 'respond:running', 'respond:done']);
    expect(snap.work).toBeNull();
    expect(currentSession(db, deps.work)?.history.nodes[0]?.items[0]?.response?.answer).toBe('one strategy per player');
  });

  it('keeps a failed answer and its error for the next read, until the next answer replaces it', async () => {
    const { db, goal, deps } = await setup([0.8, 0.8]);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    setDraft(db, `session:${snap.id}:card`, '{"answer":"one strategy per player"}');
    const events: string[] = [];
    deps.work.subscribe((e) => events.push(e.outcome));
    const release = holdTutor(deps, true);
    const pending = respond(deps, snap.id, answer('one strategy per player'), { draftKey: `session:${snap.id}:card` });
    await settle();
    release();
    await expect(pending).rejects.toThrow('ended without calling the submit tool');

    expect(events).toEqual(['running', 'failed']);
    for (const read of [1, 2]) {
      const again = currentSession(db, deps.work);
      expect(again?.work, `read ${read}`).toMatchObject({ kind: 'respond', status: 'failed', stoppable: false, error: 'tutor: the model ended without calling the submit tool' });
      expect(again?.work?.sent?.response.answer).toBe('one strategy per player');
      expect(again?.current?.stage).toBe('index'); // nothing was written: the same card is open
    }
    expect(getDrafts(db, [`session:${snap.id}:card`])).toHaveProperty(`session:${snap.id}:card`); // the answer is still there to send again

    snap = await respond(deps, snap.id, answer('one strategy per player'), { draftKey: `session:${snap.id}:card` });
    expect(snap.work).toBeNull();
    expect(getDrafts(db, [`session:${snap.id}:card`])).toEqual({}); // accepted, so the draft is gone
  });

  it('keeps an answer that was judged when the next card fails: never graded twice, the card is written on Try again', async () => {
    const { db, ids, goal, deps, provider } = await setup([0.8, 0.8, 0.8]);
    const base = fakeTutor([0.8, 0.8, 0.8]);
    let failNextCard = false;
    provider.script('tutor', (req: CompleteRequest<unknown>) => {
      const grading = /Grade the response/.test(req.messages[0]?.content ?? '');
      if (failNextCard && !grading) throw new Error('the model is overloaded');
      return base(req);
    });
    const finished: IdeaFinished[] = [];
    const withCards = { ...deps, onIdeaFinished: (e: IdeaFinished) => finished.push(e) };
    let snap = await startSession(withCards, goal.id);
    snap = await respond(withCards, snap.id, answer(''));
    const profile = ids.get('profile') as string;
    expect(snap.current).toMatchObject({ nodeId: profile, stage: 'index' });
    const key = `session:${snap.id}:card`;
    setDraft(db, key, '{"answer":"one strategy per player"}');

    // the index answer is graded and finishes the idea; the next idea's first card fails
    failNextCard = true;
    await expect(respond(withCards, snap.id, answer('one strategy per player'), { draftKey: key })).rejects.toThrow('overloaded');
    const kept = currentSession(db, deps.work);
    expect(kept).toMatchObject({ owed: true, card: null, current: { nodeId: ids.get('bestResponse') } });
    expect(kept?.plan.steps.find((st) => st.nodeId === profile)?.status).toBe('done');
    expect(listEvidenceForSession(db, snap.id).filter((e) => e.nodeId === profile)).toHaveLength(1);
    expect(finished.map((e) => e.nodeId)).toEqual([profile]); // announced once it was saved
    expect(getDrafts(db, [key])).toEqual({}); // the answer went through, so it is not offered again

    failNextCard = false;
    snap = await respond(withCards, snap.id, answer(''));
    expect(snap).toMatchObject({ owed: false, current: { nodeId: ids.get('bestResponse') } });
    expect(snap.card).not.toBeNull();
    expect(listEvidenceForSession(db, snap.id).filter((e) => e.nodeId === profile)).toHaveLength(1);
    expect(finished).toHaveLength(1);
  });

  it('refuses a second answer while one is judged, without losing the first', async () => {
    const { db, goal, deps } = await setup([0.8, 0.8]);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    const release = holdTutor(deps);
    const first = respond(deps, snap.id, answer('first'));
    await settle();
    await expect(respond(deps, snap.id, answer('second'))).rejects.toThrow('Still working on your last answer.');
    expect(currentSession(db, deps.work)?.work?.sent?.response.answer).toBe('first');
    release();
    snap = await first;
    expect(snap.history.nodes[0]?.items[0]?.response?.answer).toBe('first');
  });

  it('plans a session in the background: visible while planning, and the event names the session it opened', async () => {
    const { db, goal, deps: base } = await setup();
    let release: () => void = () => undefined;
    const hold = (req: CompleteRequest<unknown>) => new Promise((resolve) => (release = () => resolve(fakePlanner(req))));
    const deps = { ...base, provider: new FakeProvider({ planner: [hold, fakePlanner], tutor: fakeTutor([]) }) };
    const opened: (string | null)[] = [];
    deps.work.subscribe((e) => e.outcome === 'done' && opened.push(e.sessionId));
    const starting = startSession(deps, goal.id);
    await settle();
    expect(deps.work.current()).toMatchObject({ kind: 'start', status: 'running', sessionId: null, goalId: goal.id, stoppable: false });
    expect(currentSession(db, deps.work)).toBeNull();
    await expect(startSession(deps, goal.id)).rejects.toThrow('still being planned');
    release();
    const snap = await starting;
    expect(opened).toEqual([snap.id]);
    expect(deps.work.current()).toBeNull();
  });
});

describe('a session start that fails', () => {
  it('is kept until the Session screen has shown it, then forgotten', async () => {
    const { db, goal, deps: base } = await setup();
    const deps = { ...base, provider: new FakeProvider({ planner: () => Promise.reject(new Error('the model is overloaded')), tutor: fakeTutor([]) }) };
    const events: string[] = [];
    deps.work.subscribe((e) => events.push(`${e.kind}:${e.outcome}`));
    await expect(startSession(deps, goal.id)).rejects.toThrow('overloaded');
    expect(deps.work.current()).toMatchObject({ kind: 'start', status: 'failed', sessionId: null });
    deps.work.forget('any session'); // a session ending does not clear it: it has no session
    expect(deps.work.current()).not.toBeNull();
    deps.work.dismissStart();
    expect(deps.work.current()).toBeNull();
    expect(events.at(-1)).toBe('start:cleared');
    expect(currentSession(db, deps.work)).toBeNull();
  });
});

describe('flashcards in a session', () => {
  it('a card whose fact the answer recalled gets a Good review, and a finished idea goes to the card writer', async () => {
    const { db, ids, goal, deps, provider } = await setup([0.8, 0.8, 0.8]);
    const profile = ids.get('profile') as string;
    const card = saveCard(db, { front: 'What is a strategy profile?', back: 'One strategy per player', nodeIds: [profile], goalId: goal.id });
    const base = fakeTutor([0.8, 0.8, 0.8]);
    let shown = '';
    provider.script('tutor', (req: CompleteRequest<unknown>) => {
      const out = base(req) as { grade: Grade | null; card: unknown };
      const text = req.messages[0]?.content ?? '';
      if (out.grade && text.includes(card.id)) {
        shown = text;
        out.grade = { ...out.grade, recalledCards: [card.id] };
      }
      return out;
    });
    const finished: IdeaFinished[] = [];
    const withCards = { ...deps, onIdeaFinished: (e: IdeaFinished) => finished.push(e) };
    let snap = await startSession(withCards, goal.id);
    snap = await respond(withCards, snap.id, answer(''));
    expect(snap.current?.nodeId).toBe(profile);
    snap = await respond(withCards, snap.id, answer('one strategy per player'));
    // the judgement saw the card, and code recorded the review
    expect(shown).toContain('One strategy per player');
    expect(reviewsByCard(db).get(card.id)).toMatchObject([{ rating: 3, source: 'session' }]);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ sessionId: snap.id, goalId: goal.id, nodeId: profile });
    expect(finished[0]?.taught[0]).toContain('A profile is a list of strategies');
    expect(finished[0]?.answers).toEqual([expect.objectContaining({ answer: 'one strategy per player', score: 0.8 })]);
  });

  it('a grade may name only the cards it was shown', async () => {
    const { db, ids, goal, deps, provider } = await setup([0.8]);
    saveCard(db, { front: 'What is a strategy profile?', back: 'One strategy per player', nodeIds: [ids.get('profile') as string], goalId: goal.id });
    const base = fakeTutor([0.8, 0.8, 0.8]);
    let attempts = 0;
    provider.script('tutor', (req: CompleteRequest<unknown>) => {
      const out = base(req) as { grade: Grade | null; card: unknown };
      if (out.grade) {
        attempts += 1;
        out.grade = { ...out.grade, recalledCards: attempts === 1 ? ['card_made_up'] : [] };
      }
      return out;
    });
    const snap = await startSession(deps, goal.id);
    await respond(deps, snap.id, answer(''));
    await respond(deps, snap.id, answer('one strategy per player'));
    expect(attempts).toBe(2); // the made-up id went back to the model
    expect([...reviewsByCard(db).values()].flat()).toEqual([]);
  });
});

describe('teaching session', () => {
  it('runs a node through the step loop, writing evidence, own words and bugs', async () => {
    const { db, ids, goal, deps } = await setup([0.8, 0.8, 0.8, 0.2, 0.7, 0.7, 0.7, 0.8]);
    let snap = await startSession(deps, goal.id);
    expect(snap.phase).toBe('orient'); // no previous session: no reconstruct
    expect(snap.plan.steps.map((s) => s.name)).toEqual(['Strategy profile', 'Best response', 'Nash equilibrium']);
    expect(snap.plan.steps.map((s) => s.aim)).toEqual([1, 1, 3]);
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
    expect(snap.history.nodes.find((n) => n.nodeId === brId)?.items.at(-1)?.grade?.score).toBe(0.8);
    snap = await respond(deps, snap.id, { answer: '', effort: 2 });
    expect(snap.current?.stage).toBe('check');
    await walk('no idea'); // 0.2 → misconception recorded, and the question comes once more in a fresh version
    expect(snap.current?.stage).toBe('check');
    expect(listBugsForNode(db, brId)).toHaveLength(1);
    await walk('nobody gains by moving alone'); // 0.7
    expect(snap.current?.stage).toBe('derive');
    await walk('mutual best responses'); // 0.7
    expect(snap.current?.stage).toBe('connect');
    await walk('this requires payoffs'); // 0.7 → link kept for the transcript
    expect(snap.current?.stage).toBe('compress');
    snap = await respond(deps, snap.id, { answer: 'The reply that pays most given what the others do.', handle: 'best reply' });
    // the plan asks Nash to be derived: the loop stops there, with no use task on top
    expect(snap.phase).not.toBe('teach');
    expect(getState(db, brId)?.ownStatement).toBe('The reply that pays most given what the others do.');
    expect(getState(db, brId)?.handle).toBe('best reply');
    // the conversation so far: every earlier card, the answer exactly as given and its rating, rebuilt from events
    const restored = currentSession(db);
    expect(restored?.history.nodes.map((n) => n.name)).toEqual(['Strategy profile', 'Best response', 'Nash equilibrium']);
    expect(restored?.history.nodes.slice(0, 2).every((n) => n.status === 'done' && n.score !== null)).toBe(true);
    const nashItems = restored?.history.nodes[2]?.items ?? [];
    expect(nashItems.map((h) => h.stage)).toEqual(['predict', 'explain', 'check', 'check', 'derive', 'connect', 'compress']);
    expect(nashItems[0]?.response?.answer).toBe('the move that pays best given the others');
    expect(nashItems[0]?.grade?.feedback).toBe('Scored 0.8.');
    expect(nashItems[2]?.card).toEqual({ stage: 'check', question: 'Is (A,B) stable here?' });
    expect(JSON.stringify(restored?.history)).not.toContain('answerKey');
    const evidence = listEvidenceForSession(db, snap.id).filter((e) => e.nodeId === brId);
    expect(evidence.map((e) => e.kind).sort()).toEqual(['check', 'check', 'derive', 'explain', 'predict'].sort());
    expect(evidence.find((e) => e.kind === 'check')?.effort).toBe(2);
    expect(getState(db, brId)?.depth).toBe(3);
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
    const { db, ids, goal, deps } = await setup([0.8, 0.8, 0.8, 0.8]);
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

  it('drops to a worked example after three failures; an idea that ends below its aim is marked simplified', async () => {
    const { db, ids, goal, deps } = await setup([0.5, 0.5, 0.1, 0.1, 0.1, 0.1, 0.95, 0.95]);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    const nashId = ids.get('nash') as string;
    while (snap.phase === 'teach' && snap.current?.nodeId !== nashId) snap = await respond(deps, snap.id, answer('x'));
    // the index passes consumed two scores; Nash: predict 0.1 (a guess, no failure), check 0.1 twice (it is asked again), derive 0.1 → support
    snap = await respond(deps, snap.id, answer('wrong'));
    expect(snap.current?.stage).toBe('explain');
    snap = await respond(deps, snap.id, answer(''));
    expect(snap.current?.stage).toBe('check');
    snap = await respond(deps, snap.id, answer('wrong again'));
    expect(snap.current?.stage).toBe('check'); // asked once more
    snap = await respond(deps, snap.id, answer('and again'));
    expect(snap.current?.stage).toBe('derive');
    snap = await respond(deps, snap.id, answer('still wrong'));
    expect(snap.current?.stage).toBe('support');
    snap = await respond(deps, snap.id, answer(''));
    expect(snap.current?.stage).toBe('connect'); // resumes after the stage that triggered support
    snap = await respond(deps, snap.id, answer('this requires payoffs')); // 0.95
    expect(snap.current?.stage).toBe('compress');
    snap = await respond(deps, snap.id, answer('own words')); // 0.95: explained, never derived
    expect(snap.phase).not.toBe('teach');
    expect(getState(db, nashId)?.depth).toBe(2);
    const target = listTargets(db, goal.id, { all: true }).find((t) => t.nodeId === nashId);
    expect(target?.simplified).toBe('Learned to explaining it within its half hour; the plan asked deriving it');
    expect(target?.approvedDepth).toBe(2);
  });

  it('checks off an idea the learner knows: a strong prediction goes straight to the question that shows the aim', async () => {
    const { db, ids, goal, deps } = await setup([0.8, 0.8, 0.95, 0.9]);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    const nashId = ids.get('nash') as string;
    while (snap.phase === 'teach' && snap.current?.nodeId !== nashId) snap = await respond(deps, snap.id, answer('one strategy per player'));
    expect(snap.current?.canTestOut).toBe(true);
    const before = deps.provider.calls.filter((c) => c.role === 'tutor').length;
    snap = await respond(deps, snap.id, answer('nobody gains by moving alone: each plays a best reply', 0.9));
    expect(snap.current?.stage).toBe('derive');
    // the call that graded the strong prediction wrote the test-out question: no explanation written to be thrown away
    expect(deps.provider.calls.filter((c) => c.role === 'tutor').length - before).toBe(1);
    expect(snap.history.nodes.find((n) => n.nodeId === nashId)?.items.map((h) => h.stage)).toEqual(['predict']);
    snap = await respond(deps, snap.id, answer('mutual best responses, both directions', 0.9));
    expect(snap.phase).not.toBe('teach');
    expect(listEvidenceForSession(db, snap.id).filter((e) => e.nodeId === nashId).map((e) => e.kind)).toEqual(['predict', 'derive']);
    expect(getState(db, nashId)?.depth).toBe(3);
  });

  it('"Test me" jumps to the aim\u2019s question, and failing it goes back to teaching', async () => {
    const { ids, goal, deps } = await setup([0.8, 0.8, 0.3, 0.8]);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    const nashId = ids.get('nash') as string;
    while (snap.phase === 'teach' && snap.current?.nodeId !== nashId) snap = await respond(deps, snap.id, answer('one strategy per player'));
    snap = await respond(deps, snap.id, { answer: '', testMe: true });
    expect(snap.current?.stage).toBe('derive');
    expect(snap.current?.canTestOut).toBe(false);
    snap = await respond(deps, snap.id, answer('something vague')); // 0.3
    expect(snap.current?.stage).toBe('explain');
    const items = snap.history.nodes.find((n) => n.nodeId === nashId)?.items ?? [];
    expect(items.map((h) => [h.stage, h.response?.testMe ?? false])).toEqual([
      ['predict', true],
      ['derive', false],
    ]);
  });

  it('an idea the plan asks to explain runs four cards and is never derived or applied', async () => {
    const { db, ids, goal, deps } = await setup([0.8, 0.8, 0.8, 0.8, 0.8]);
    const nashId = ids.get('nash') as string;
    for (const t of listTargets(db, goal.id, { all: true }).filter((x) => x.nodeId === nashId)) capTargets(db, goal.id, t.nodeId, 2, 'test cap');
    refreshGoalFields(db);
    let snap = await startSession(deps, goal.id);
    expect(snap.plan.steps.find((st) => st.nodeId === nashId)?.aim).toBe(2);
    snap = await respond(deps, snap.id, answer(''));
    while (snap.phase === 'teach' && snap.current?.nodeId !== nashId) snap = await respond(deps, snap.id, answer('one strategy per player'));
    expect(snap.current?.stages).toEqual(['predict', 'explain', 'check', 'compress']);
    let guard = 0;
    while (snap.phase === 'teach' && guard++ < 10) snap = await respond(deps, snap.id, answer('an answer', 0.66));
    const stages = currentSession(db)?.history.nodes.find((n) => n.nodeId === nashId)?.items.map((h) => h.stage);
    expect(stages).toEqual(['predict', 'explain', 'check', 'compress']);
  });

  it('simplifies an idea when the learner lacks what it needs, and the ideas built on it', async () => {
    const { db, ids, goal, deps } = await setup([0.8, 0.8, 0.6, 0.2, 0.8], [{ key: 'nashMutualBr', depth: 3 }]);
    const nashId = ids.get('nash') as string;
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    while (snap.phase === 'teach' && snap.current?.nodeId !== nashId) snap = await respond(deps, snap.id, answer('one strategy per player'));
    snap = await respond(deps, snap.id, answer('a guess about stability')); // predict 0.6
    snap = await respond(deps, snap.id, { answer: '' }); // explain read
    expect(snap.current?.stage).toBe('check');
    snap = await respond(deps, snap.id, answer("I've never heard of a best reply")); // 0.2 and a missing prerequisite
    expect(snap.current?.stage).toBe('explain'); // a fresh, plain explanation of the core idea
    expect(snap.current?.aim).toBe(2);
    expect(snap.current?.simplified).toBe("It needs best responses, which this goal's time does not also cover");
    expect(snap.current?.stages).toEqual(['predict', 'explain', 'check', 'compress']);
    const last = deps.provider.calls.at(-1)?.messages[0]?.content ?? '';
    expect(last).toContain('## Simplified for this learner');
    const targets = listTargets(db, goal.id, { all: true });
    expect(targets.find((t) => t.nodeId === nashId)?.approvedDepth).toBe(2);
    const built = targets.find((t) => t.nodeId === ids.get('nashMutualBr'));
    expect(built?.simplified).toBe('Simplified with Nash equilibrium');
    expect(built?.depth).toBeLessThanOrEqual(2);
    // the missing foundation is noted for the goal's map too
    expect(getGoal(db, goal.id)?.gaps.map((g) => [g.name, g.source])).toEqual([['best responses', 'session']]);
  });

  it('gives an idea its half hour: past it, one last step in the learner\u2019s own words, then on', async () => {
    const { db, ids, goal, deps } = await setup([0.8, 0.8, 0.6, 0.6, 0.8]);
    const nashId = ids.get('nash') as string;
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    while (snap.phase === 'teach' && snap.current?.nodeId !== nashId) snap = await respond(deps, snap.id, answer('one strategy per player'));
    snap = await respond(deps, snap.id, answer('a guess')); // predict 0.6
    snap = await respond(deps, snap.id, { answer: '' }); // explain read → check
    logTime(db, 'session', { goalId: goal.id, sessionId: snap.id, nodeId: nashId }, 31 * 60);
    snap = await respond(deps, snap.id, answer('partly')); // check 0.6, past the half hour
    expect(snap.current?.stage).toBe('compress');
    expect(snap.current?.note).toMatch(/half hour/);
    snap = await respond(deps, snap.id, answer('in my words')); // 0.8
    expect(snap.phase).not.toBe('teach');
    expect(listTargets(db, goal.id, { all: true }).find((t) => t.nodeId === nashId)?.simplified).toMatch(/^Learned to explaining it/);
  });

  it('goes deeper on a simplified idea: its minutes join the goal, and a session takes it to the depth the goal asks', async () => {
    const { db, ids, goal, deps } = await setup([0.8, 0.8, 0.8]);
    const nashId = ids.get('nash') as string;
    // Nash was learned as an intuition: explained, and capped below the derivation the goal asks
    recordEvidence(db, { nodeId: nashId, kind: 'explain', score: 0.9, reasoning: 'own words' });
    capTargets(db, goal.id, nashId, 2, 'It needs best responses, which this goal does not also cover');
    refreshGoalFields(db);
    const estimate = deeperMinutes(db, goal.id);
    expect(estimate.ideas.map((i) => [i.nodeId, i.minutes])).toEqual([[nashId, 5]]); // a term from explain to derive, at least five minutes
    expect(goDeeper(db, goal.id, [nashId])).toEqual({ minutes: 5, nodeIds: [nashId] });
    expect(getGoal(db, goal.id)?.extraMinutes).toBe(5);
    expect(listTargets(db, goal.id, { all: true }).find((t) => t.nodeId === nashId)?.simplified).toBeNull();
    expect(deeperMinutes(db, goal.id).ideas).toHaveLength(0);

    const callsBefore = deps.provider.calls.filter((c) => c.role === 'planner').length;
    let snap = await startSession(deps, goal.id, [nashId]);
    expect(deps.provider.calls.filter((c) => c.role === 'planner')).toHaveLength(callsBefore); // chosen, not planned
    expect(snap.plan.title).toBe('Going deeper');
    const step = snap.plan.steps.find((st) => st.nodeId === nashId);
    expect(step).toMatchObject({ aim: 3, fromDepth: 2 });
    snap = await respond(deps, snap.id, answer(''));
    while (snap.phase === 'teach' && snap.current?.nodeId !== nashId) snap = await respond(deps, snap.id, answer('one strategy per player'));
    expect(snap.current?.stages).toEqual(['predict', 'explain', 'derive']);
  });

  it('fits a session into 45 minutes: the planner may pick more, code keeps what fits', async () => {
    const { db, ids, goal, deps } = await setup([], [{ key: 'nashMutualBr', depth: 3 }, { key: 'findPureNash', depth: 3 }, { key: 'spe', depth: 3 }]);
    recordEvidence(db, { nodeId: ids.get('nash') as string, kind: 'derive', score: 1, reasoning: 'known' });
    recordEvidence(db, { nodeId: ids.get('bestResponse') as string, kind: 'derive', score: 1, reasoning: 'known' });
    recordEvidence(db, { nodeId: ids.get('profile') as string, kind: 'derive', score: 1, reasoning: 'known' });
    refreshGoalFields(db);
    deps.provider.script('planner', (req: CompleteRequest<unknown>) => {
      const text = (req.messages[0]?.content ?? '').split('## Candidates')[1] ?? '';
      expect(text).toMatch(/the session has about 45 minutes/);
      const all = [...text.matchAll(/- \[(node_[a-z0-9_]+)\]/g)].map((m) => m[1] as string);
      return { title: 'Big day', orientation: 'Everything at once, which will not fit.', steps: all.slice(0, 6).map((nodeId) => ({ nodeId, why: 'needed' })) };
    });
    const snap = await startSession(deps, goal.id);
    const minutes = snap.plan.steps.reduce((sum, st) => sum + st.minutes, 0);
    expect(snap.plan.steps.length).toBeGreaterThan(0);
    expect(minutes <= 45 || snap.plan.steps.length === 1).toBe(true);
  });

  it('escalates to a fresh explanation from the escalation model when the learner fails after a worked example', async () => {
    const { ids, goal, deps } = await setup([0.5, 0.5, 0.1, 0.1, 0.1, 0.1, 0.2, 0.8]);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    const nashId = ids.get('nash') as string;
    while (snap.phase === 'teach' && snap.current?.nodeId !== nashId) snap = await respond(deps, snap.id, answer('x'));
    snap = await respond(deps, snap.id, answer('wrong')); // predict 0.1
    snap = await respond(deps, snap.id, answer('')); // explain read
    snap = await respond(deps, snap.id, answer('wrong')); // check 0.1: asked once more
    snap = await respond(deps, snap.id, answer('wrong')); // check 0.1 again
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

describe('images and a quoted reply on an answer', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  it('sends them with the tutor call, stores them with the response and shows them in the history', async () => {
    const { db, goal, deps } = await setup([0.8, 0.8]);
    const attachmentsDir = mkdtempSync(join(tmpdir(), 'frontier-att-'));
    const withDir = { ...deps, attachmentsDir };
    const name = saveAttachment(attachmentsDir, { mediaType: 'image/png', data: PNG });
    let snap = await startSession(withDir, goal.id);
    snap = await respond(withDir, snap.id, answer(''));
    expect(snap.current?.stage).toBe('index');
    const before = deps.provider.calls.length;

    snap = await respond(withDir, snap.id, { answer: '', attachments: [name], quote: '  A profile is a list of strategies.  ' });
    const tutorCall = deps.provider.calls.slice(before).find((c) => c.role === 'tutor');
    expect(tutorCall?.images).toEqual([{ mediaType: 'image/png', data: PNG }]);
    const said = tutorCall?.messages[0]?.content.split("## Learner's response")[1] ?? '';
    expect(said).toContain('The learner is replying to this part: "A profile is a list of strategies."');
    expect(said).toContain('the answer is in the attached images');
    expect(said).toContain('attached images: 1');

    // the history is rebuilt from stored events, as after a restart
    const item = currentSession(db)?.history.nodes[0]?.items[0];
    expect(item?.response).toMatchObject({ answer: '', attachments: [name], quote: 'A profile is a list of strategies.' });
  });

  it('refuses attachments that were never saved, too many of them, or names that are not attachment names', async () => {
    const { goal, deps } = await setup([0.8]);
    const attachmentsDir = mkdtempSync(join(tmpdir(), 'frontier-att-'));
    const withDir = { ...deps, attachmentsDir };
    const name = saveAttachment(attachmentsDir, { mediaType: 'image/png', data: PNG });
    let snap = await startSession(withDir, goal.id);
    snap = await respond(withDir, snap.id, answer(''));
    const calls = deps.provider.calls.length;
    await expect(respond(withDir, snap.id, { answer: 'x', attachments: [`${'a'.repeat(64)}.png`] })).rejects.toThrow('was not saved');
    await expect(respond(withDir, snap.id, { answer: 'x', attachments: Array(5).fill(name) as string[] })).rejects.toThrow('At most 4 images');
    await expect(respond(withDir, snap.id, { answer: 'x', attachments: ['../frontier.db'] })).rejects.toThrow('not an attachment name');
    await expect(respond(deps, snap.id, { answer: 'x', attachments: [name] })).rejects.toThrow('was not saved');
    expect(deps.provider.calls.length).toBe(calls); // nothing reached the model
    // a plain answer still goes through, with no empty extras stored
    snap = await respond(withDir, snap.id, { answer: 'one strategy per player', attachments: [], quote: ' ' });
    expect(snap.history.nodes[0]?.items[0]?.response).toEqual({ answer: 'one strategy per player' });
  });
});

describe('R7: an answer is judged once, whatever happens next', () => {
  /** A planner that picks exactly these ideas, by name. */
  const pick = (...names: string[]) => (req: CompleteRequest<unknown>) => {
    const text = (req.messages[0]?.content ?? '').split('## Candidates')[1] ?? '';
    const all = [...text.matchAll(/- \[(node_[a-z0-9_]+)\] ([^(]+) \(/g)].map((m) => ({ id: m[1] as string, name: (m[2] as string).trim() }));
    return { title: 'Today', orientation: 'Today builds on what you know.', steps: all.filter((c) => names.includes(c.name)).map((c) => ({ nodeId: c.id, why: 'needed for the exam' })) };
  };

  it('is saved as answered before the next card is asked for, so a quit in between cannot ask it again', async () => {
    const { db, ids, goal, deps } = await setup([0.9]);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer('')); // begin: the first idea's one question
    expect(snap.current?.stage).toBe('index');
    const answered = snap.current?.nodeId;

    // what a quit during the follow-up call would leave on disk
    let onDisk: SessionState | undefined;
    const tutor = fakeTutor([0.9]);
    deps.provider.script('tutor', (req: CompleteRequest<unknown>) => {
      const text = req.messages[0]?.content ?? '';
      if (!/Grade the response/.test(text)) onDisk = getSession<SessionState>(db, snap.id)?.state;
      return tutor(req);
    });
    const after = await respond(deps, snap.id, answer('one strategy per player', 0.9));
    expect(after.current?.nodeId).not.toBe(answered); // on to the next idea
    expect(onDisk?.owed).toBe(true);
    expect(onDisk?.card).toBeNull(); // not the card that was answered
    expect(onDisk?.plan.steps[onDisk.stepIndex]?.nodeId).toBe(after.current?.nodeId);
    expect(listEvidenceForSession(db, snap.id).filter((e) => e.nodeId === answered)).toHaveLength(1);
    expect(after.owed).toBe(false);
    void ids;
  });

  it('a failed test-out goes back to teaching once, not round and round', async () => {
    // strong prediction, then the check is missed twice
    const { goal, deps } = await setup([0.95, 0.3, 0.3, 0.8], [], pick('Strictly dominant strategy'));
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    expect(snap.current?.stage).toBe('predict');
    snap = await respond(deps, snap.id, answer('It beats every other strategy whatever the others do.', 0.9));
    expect(snap.current?.stage).toBe('check'); // tested out of the explanation
    snap = await respond(deps, snap.id, answer('Not sure.', 0.33));
    expect(snap.current?.stage).toBe('explain'); // back to teaching
    snap = await respond(deps, snap.id, { answer: '' });
    expect(snap.current?.stage).toBe('check');
    snap = await respond(deps, snap.id, answer('Still not sure.', 0.33));
    expect(snap.current?.stage).not.toBe('explain'); // an ordinary miss now: the loop goes on
  });

  it('an idea planned for transfer is not marked simplified when the session takes it as far as a session can', async () => {
    const { db, ids, goal, deps } = await setup([0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95], [], pick('Strictly dominant strategy'));
    addCapabilities(db, goal.id, [{ statement: 'Can transfer dominance', targets: [{ nodeId: ids.get('dominant') as string, depth: 5 }] }]);
    refreshGoalFields(db);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    for (let i = 0; i < 12 && snap.current?.nodeId === ids.get('dominant'); i += 1) snap = await respond(deps, snap.id, snap.card && 'markdown' in snap.card ? { answer: '' } : answer('A full, correct answer.', 0.9));
    expect(getState(db, ids.get('dominant') as string)?.depth).toBe(4);
    const targets = listTargets(db, goal.id, { all: true });
    expect(targets.filter((t) => t.nodeId === ids.get('dominant')).every((t) => !t.simplified)).toBe(true);
    expect(targets.filter((t) => t.nodeId === ids.get('dominantNash')).every((t) => !t.simplified)).toBe(true); // the idea built on it keeps its depth
  });

  it('never plans an idea without the ideas it is built on', async () => {
    const { ids, goal, deps } = await setup([], [], pick('Nash equilibrium')); // built on strategy profile and best response, neither owned
    const snap = await startSession(deps, goal.id);
    const order = snap.plan.steps.map((s) => s.nodeId);
    expect(order.at(-1)).toBe(ids.get('nash'));
    expect(order.slice(0, -1).sort()).toEqual([ids.get('profile'), ids.get('bestResponse')].sort());
    expect(snap.plan.steps.find((s) => s.nodeId === ids.get('profile'))?.why).toBe('Nash equilibrium is built on it.');
  });

  it('ending a session while its next card is being written leaves nothing more in it', async () => {
    const { db, goal, deps } = await setup([0.9]);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    const tutor = fakeTutor([0.9]);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    deps.provider.script('tutor', async (req: CompleteRequest<unknown>) => {
      if (!/Grade the response/.test(req.messages[0]?.content ?? '')) await held; // the next idea's first card
      return tutor(req);
    });
    const judging = respond(deps, snap.id, answer('one strategy per player', 0.9));
    await settle();
    await settle();
    await abandonSession(deps, snap.id);
    const events = listSessionEvents(db, snap.id).length;
    release();
    await expect(judging).rejects.toThrow('cancelled');
    expect(listSessionEvents(db, snap.id)).toHaveLength(events);
    expect(deps.work.current()).toBeNull();
  });

  it('a go-deeper session is a chosen one: no recall, no practice, and the planned session before it still carries', async () => {
    const { db, ids, goal, deps } = await setup([0.8, 0.8, 0.8, 0.8]);
    // a planned session, ended inside its first idea
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    const half = snap.current?.nodeId;
    await abandonSession(deps, snap.id);
    // then a session on one chosen idea, ended too
    capTargets(db, goal.id, ids.get('dominant') as string, 1, 'It was taking too long');
    const deeper = await startSession(deps, goal.id, [ids.get('dominant') as string]);
    expect(deeper.phase).toBe('orient'); // no recall of the planned session
    await abandonSession(deps, deeper.id);
    // the next planned session picks up the half-done idea of the planned one
    const next = await startSession(deps, goal.id);
    expect(next.plan.steps[0]?.nodeId).toBe(half);
  });
});

describe('R7 B1: asking the tutor', () => {
  /** The session's tutor, which also answers what the learner asks; it records what it was asked. */
  function withAsides(deps: Awaited<ReturnType<typeof setup>>['deps'], scores: number[]) {
    const asked: string[] = [];
    const tutor = fakeTutor(scores);
    deps.provider.script('tutor', (req: CompleteRequest<unknown>) => {
      if (req.submit.name !== 'submit_answer') return tutor(req);
      asked.push(req.messages[0]?.content ?? '');
      return { answer: 'Think of it as a promise each player keeps because breaking it would only hurt themselves.' };
    });
    return asked;
  }
  const pickDominant = (req: CompleteRequest<unknown>) => {
    const text = (req.messages[0]?.content ?? '').split('## Candidates')[1] ?? '';
    const all = [...text.matchAll(/- \[(node_[a-z0-9_]+)\] ([^(]+) \(/g)].map((m) => ({ id: m[1] as string, name: (m[2] as string).trim() }));
    return { title: 'Dominance', orientation: 'Today builds on what you know.', steps: all.filter((c) => c.name === 'Strictly dominant strategy').map((c) => ({ nodeId: c.id, why: 'needed for the exam' })) };
  };

  it('answers under the open card without grading anything, and keeps the answer in the conversation and the trail', async () => {
    const { db, goal, deps } = await setup([0.4, 0.8, 0.8], [], pickDominant);
    const asked = withAsides(deps, [0.4, 0.8, 0.8]);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    snap = await respond(deps, snap.id, answer('Not sure.', 0.33)); // the prediction: on to the explanation
    expect(snap.current?.stage).toBe('explain');
    const evidence = listEvidenceForSession(db, snap.id).length;

    snap = await askTutor(deps, snap.id, { mode: 'simpler' });
    expect(snap.current?.stage).toBe('explain'); // the card stays
    expect(snap.asides).toEqual([expect.objectContaining({ mode: 'simpler', question: '', answer: expect.stringContaining('promise') })]);
    expect(listEvidenceForSession(db, snap.id)).toHaveLength(evidence); // nothing graded
    expect(asked[0]).toContain('asked for a simpler explanation');
    expect(asked[0]).not.toContain('has not answered yet');

    // on to the check: a question of the learner's own, about an open question
    snap = await respond(deps, snap.id, { answer: '' });
    expect(snap.current?.stage).toBe('check');
    expect(snap.asides).toEqual([]); // asides belong to the card they were asked about
    snap = await askTutor(deps, snap.id, { mode: 'question', question: 'What does "whatever the others do" mean here?' });
    expect(asked[1]).toContain('What does "whatever the others do" mean here?');
    expect(asked[1]).toContain('has not answered yet. Do not answer it for them');
    expect(snap.asides[0]?.question).toBe('What does "whatever the others do" mean here?');

    // the explanation's aside is in the conversation, under its card, and in the trail
    const explained = snap.history.nodes.flatMap((n) => n.items).find((i) => i.stage === 'explain');
    expect(explained?.asides.map((a) => a.mode)).toEqual(['simpler']);
    const steps = trail(db, snap.id)?.items.filter((i) => i.type === 'step') ?? [];
    expect(steps.find((i) => i.type === 'step' && i.stage === 'explain' && i.asides.length === 1)).toBeDefined();
    // what the tutor said is taught material for the card writer and the map
    expect(getSession<SessionState>(db, snap.id)?.state.transcript.some((t) => t.text.includes('promise'))).toBe(true);
  });

  it('refuses an empty question and a session with no card open', async () => {
    const { goal, deps } = await setup([0.8], [], pickDominant);
    withAsides(deps, [0.8]);
    const snap = await startSession(deps, goal.id);
    await expect(askTutor(deps, snap.id, { mode: 'question', question: 'Why?' })).rejects.toThrow('no card open'); // still at the orientation
    const teaching = await respond(deps, snap.id, answer(''));
    await expect(askTutor(deps, teaching.id, { mode: 'question', question: '   ' })).rejects.toThrow('Write your question first');
    await expect(askTutor(deps, teaching.id, { mode: 'question', question: 'x'.repeat(2001) })).rejects.toThrow('up to 2000 characters');
  });

  it('gives up to two hints on a question, and an answer given with hints counts for less', async () => {
    const { db, ids, goal, deps } = await setup([0.4, 1, 0.8], [], pickDominant);
    const asked = withAsides(deps, [0.4, 1, 0.8]);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    expect(snap.current?.hintsLeft).toBe(0); // a prediction is a guess: no hints
    snap = await respond(deps, snap.id, answer('Not sure.', 0.33));
    snap = await respond(deps, snap.id, { answer: '' });
    expect(snap.current?.stage).toBe('check');
    expect(snap.current?.hintsLeft).toBe(2);

    snap = await askTutor(deps, snap.id, { mode: 'hint' });
    expect(snap.current?.hintsLeft).toBe(1);
    expect(asked[0]).toContain('Answer key: Yes'); // the tutor sees the answer to hint toward it
    expect(asked[0]).toContain('This is hint 1 of at most 2.');
    snap = await askTutor(deps, snap.id, { mode: 'hint' });
    expect(asked[1]).toContain('## Hints already given on this question');
    expect(snap.current?.hintsLeft).toBe(0);
    await expect(askTutor(deps, snap.id, { mode: 'hint' })).rejects.toThrow('no more hints');
    // a hint is not teaching material
    expect(getSession<SessionState>(db, snap.id)?.state.transcript.filter((t) => t.text.includes('promise'))).toHaveLength(0);

    // a perfect answer with both hints counts as 0.7: a pass, but not a strong one
    snap = await respond(deps, snap.id, answer('Yes: neither player gains by moving alone.', 0.9));
    const evidence = listEvidenceForSession(db, snap.id).find((e) => e.nodeId === ids.get('dominant') && e.kind === 'check');
    expect(evidence?.score).toBeCloseTo(0.7);
    expect(evidence?.context.hints).toBe(2);
    expect(snap.current?.stage).toBe('compress'); // it passed, so the question is not asked again
    const checked = snap.history.nodes.flatMap((n) => n.items).find((i) => i.stage === 'check');
    expect(checked?.grade?.score).toBe(1); // the tutor's judgement of the answer itself is kept
    expect(checked?.asides.filter((a) => a.mode === 'hint')).toHaveLength(2);
  });

  it('asks a missed question again and tells the tutor to write a fresh one', async () => {
    const { goal, deps } = await setup([0.4, 0.3, 0.8, 0.8], [], pickDominant);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    snap = await respond(deps, snap.id, answer('Not sure.', 0.33));
    snap = await respond(deps, snap.id, { answer: '' });
    const before = deps.provider.calls.length;
    snap = await respond(deps, snap.id, answer('It is the best outcome for everyone.', 0.66)); // 0.3
    expect(snap.current?.stage).toBe('check');
    // the call that graded the miss wrote the fresh question too: one call, no card thrown away
    expect(deps.provider.calls.slice(before)).toHaveLength(1);
    const retry = deps.provider.calls.slice(before).at(-1)?.messages[0]?.content ?? '';
    expect(retry).toContain('- Score below 0.70: the **check** card again, as a fresh question on the same step from another side (not the same one reworded)');
    snap = await respond(deps, snap.id, answer('No player gains by changing alone.', 0.66)); // 0.8
    expect(snap.current?.stage).toBe('compress');
  });
});


describe('R7 C1: explanations shown as they are written', () => {
  const pickDominant = (req: CompleteRequest<unknown>) => {
    const text = (req.messages[0]?.content ?? '').split('## Candidates')[1] ?? '';
    const all = [...text.matchAll(/- \[(node_[a-z0-9_]+)\] ([^(]+) \(/g)].map((m) => ({ id: m[1] as string, name: (m[2] as string).trim() }));
    return { title: 'Dominance', orientation: 'Today builds on what you know.', steps: all.filter((c) => c.name === 'Strictly dominant strategy').map((c) => ({ nodeId: c.id, why: 'needed for the exam' })) };
  };

  it('the explanation reaches the window while it is written, and is gone once the card is there', async () => {
    const { goal, deps } = await setup([0.4, 0.8, 0.8], [], pickDominant);
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, answer(''));
    expect(snap.current?.stage).toBe('predict');
    const seen: string[] = [];
    const stop = deps.work.subscribe((event) => {
      if (event.work?.writing) seen.push(event.work.writing);
    });
    snap = await respond(deps, snap.id, answer('Not sure.', 0.33));
    await new Promise((resolve) => setTimeout(resolve, 200));
    stop();
    expect(snap.current?.stage).toBe('explain');
    // the text grew toward the card as written, without the JSON around it
    expect(seen.length).toBeGreaterThan(0);
    const card = snap.card as { markdown: string };
    expect(card.markdown.startsWith(seen[seen.length - 1] ?? 'x')).toBe(true);
    expect(seen.every((text) => !text.includes('"stage"'))).toBe(true);
    expect(deps.work.current()?.writing ?? null).toBeNull();
  });
});
