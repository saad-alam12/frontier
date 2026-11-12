/**
 * The teaching session (design §4): reconstruct → orient → teach each node with the step loop →
 * close → preview. State is persisted after every transition so the app can resume at the same card.
 * This module holds what the app calls (start, respond, ask, pause, end); the step loop is in
 * `sessionSteps.ts`, what the window sees in `sessionView.ts`, the stored state in `sessionState.ts`.
 */
import { runRecall, runTutorAside } from '../agents/tutor';
import type { LearnerResponse, AsideMode } from '../agents/tutor';
import { HINT_STAGES, MAX_HINTS, emptyEdge, isGraded } from '../core/session';
import type { IdeaFinished } from '../core/cards';
import { isCancelled } from '../llm/provider';
import { ResponseExtrasSchema } from '../core/attachments';
import { attachmentExists } from '../store/attachments';
import type { Database } from '../store/db';
import { nowIso } from '../store/db';
import { logEvent, secondsOnNode } from '../store/activity';
import { getGoal } from '../store/goals';
import { activeSession, appendSessionEvent, createSession, endSession, getSession, listEndedSessions, listSessionEvents, saveSessionState } from '../store/sessions';
import type { SessionRecord } from '../store/sessions';
import { deleteDrafts } from '../store/drafts';
import { recordEvidence } from './evidence';
import { loadKnowledge, refreshGoalFields } from './knowledge';
import { MAX_PLAN_NODES, planFocusSession, planSession } from './planner';
import { practiceView, submitPracticeAnswer } from './practice';
import type { SessionWork } from './sessionWork';
import type { NodeStatus, SessionState, SessionDeps } from './sessionState';
import { normalized } from './sessionState';
import type { SessionSnapshot } from './sessionView';
import { publicCard, snapshot } from './sessionView';
import { openAsides } from './sessionAsides';
import { beginStep, produceCard, handleTeachResponse, stillOpen } from './sessionSteps';
import { imagesOf, tutorGoalFor, buildTutorInput } from './sessionTutorInput';
import { previouslyTaughtNodes, carriedPlace, withCarriedStep, carryEvents } from './sessionCarry';

/** The longest question the learner can ask the tutor, in characters. */
export const ASIDE_MAX_CHARS = 2000;

export function currentSession(db: Database, work?: SessionWork): SessionSnapshot | null {
  const session = activeSession<SessionState>(db);
  return session ? snapshot(db, normalized(session), work) : null;
}

/** A session asked to fit a time lasts between these, in minutes. */
const SESSION_MINUTES = { min: 10, max: 90 };

/**
 * Open a session on the goal (or return the open one). `focus`: a session the learner chose, going
 * deeper on those ideas. Planning runs as the session's work, so it goes on when the screen closes.
 * `wanted`: the time the learner has ("I have 30 minutes"); the planner fits the session to it
 * (10 to 90 minutes) instead of 45.
 */
export async function startSession(deps: SessionDeps, goalId: string, focus?: string[], wanted?: number): Promise<SessionSnapshot> {
  const { db } = deps;
  const minutes = wanted === undefined ? undefined : Math.max(SESSION_MINUTES.min, Math.min(SESSION_MINUTES.max, Math.round(wanted)));
  const active = activeSession<SessionState>(db);
  if (active) return snapshot(db, normalized(active), deps.work);
  const sessionId = await deps.work.run({ kind: 'start', sessionId: null, goalId, sent: null, stoppable: false }, () => openGoalSession(deps, goalId, focus, minutes), (id) => id);
  return snapshot(db, getSession<SessionState>(db, sessionId) as SessionRecord<SessionState>, deps.work);
}

async function openGoalSession(deps: SessionDeps, goalId: string, focus: string[] | undefined, minutes?: number): Promise<string> {
  const { db } = deps;
  const goal = getGoal(db, goalId);
  if (!goal) throw new Error(`unknown goal ${goalId}`);
  // only the goal's own planned sessions carry a half-done idea or are recalled: a chosen session
  // counted toward the goal is stored under it too, and must not hide the planned one before it
  const ended = listEndedSessions<SessionState>(db, goalId).map(normalized).filter((s) => !s.state.free && !s.state.chosen);
  const view = loadKnowledge(db);
  // an idea erased from the map since has nothing left to carry, so it counts as reached
  const carried = ended[0] && !focus?.length ? carriedPlace(ended[0], (id, depth) => !view.nodes.has(id) || ((view.states.get(id)?.depth ?? 0) >= depth && (depth < 2 || view.owned.has(id)))) : null;
  const planned = focus?.length ? planFocusSession(db, goalId, focus) : await planSession(db, deps.provider, goalId, { maxNodes: carried ? MAX_PLAN_NODES - 1 : MAX_PLAN_NODES, reservedMinutes: carried?.step.minutes ?? 0, sessionMinutes: minutes });
  const plan = carried ? withCarriedStep(planned, carried.step) : planned;
  if (plan.steps.length === 0) throw new Error(`Nothing to teach for this goal yet: ${plan.orientation}`);
  // a session the learner chose (going deeper) is about those ideas: no recall of the last planned session
  const previousNodes = focus?.length ? [] : previouslyTaughtNodes(ended);
  // the question the last session left opens this one (design §4.1, "Preview"), with the recall of its ideas
  const opening = previousNodes.length ? ended[0]?.state.closing?.previewQuestion?.trim() || null : null;
  const state: SessionState = {
    goalId,
    chosen: Boolean(focus?.length) || undefined,
    plan,
    phase: previousNodes.length ? 'reconstruct' : 'orient',
    stepIndex: 0,
    stage: null,
    supportAfter: null,
    card: null,
    edge: emptyEdge(),
    nodeStatus: Object.fromEntries(plan.steps.map((s) => [s.nodeId, 'pending' as NodeStatus])),
    history: {},
    transcript: [],
    previousNodes,
    closing: null,
    pendingEffort: null,
    resume: carried?.resume ?? null,
    priorMinutes: carried ? { [carried.step.nodeId]: secondsOnNode(db, [carried.resume.fromSessionId], carried.step.nodeId) / 60 } : {},
    opening,
  };
  if (carried) state.nodeStatus[carried.step.nodeId] = 'active';
  const session = createSession(db, goalId, state);
  logEvent(db, 'session.started', { goalId, sessionId: session.id }, { steps: plan.steps.length });
  appendSessionEvent(db, session.id, 'start', { goalId, plan: { title: plan.title, steps: plan.steps.map((s) => s.nodeId) }, resumes: carried ? { nodeId: carried.step.nodeId, fromSessionId: carried.resume.fromSessionId } : null });
  if (carried) carryEvents(db, carried.resume.fromSessionId, session.id, carried.step.nodeId);
  return session.id;
}

/** Pause keeps the session active: reopening resumes at the same card with nothing regenerated. */
export function pauseSession(db: Database, sessionId: string): void {
  const session = getSession<SessionState>(db, sessionId);
  if (!session || session.status !== 'active') return;
  appendSessionEvent(db, sessionId, 'pause', {});
}

/**
 * End a session early. What was learned stays as evidence, the tutor's prose is ingested, and the
 * next session on the goal recalls the finished ideas and continues a half-done one where it stopped.
 * Answers the goal it was on, which may now want a new map.
 */
export async function abandonSession(deps: SessionDeps, sessionId: string): Promise<{ goalId: string | null }> {
  const { db } = deps;
  const session = getSession<SessionState>(db, sessionId);
  if (!session || session.status !== 'active') return { goalId: session?.goalId ?? null };
  // an answer still being judged is stopped if it can be; if not, the work stops itself at its next step (stillOpen)
  deps.work.cancel(sessionId);
  endSession(db, sessionId, 'abandoned');
  deps.work.forget(sessionId);
  appendSessionEvent(db, sessionId, 'abandon', {});
  logEvent(db, 'session.ended', { goalId: session.goalId, sessionId }, { status: 'abandoned' });
  refreshGoalFields(db);
  await ingestTranscript(deps, sessionId, session.state);
  return { goalId: session.goalId };
}

/**
 * Advance the session with the learner's response to the current card (or an acknowledgement). It runs
 * as the session's work: a second answer is refused while one is judged, and answers to questions carry
 * a commit gate, so until the tutor's first call answers Esc stops the request and nothing has been
 * written (every write comes after that call). `draftKey`: the unsent answer, deleted once accepted.
 */
export async function respond(deps: SessionDeps, sessionId: string, response: LearnerResponse, options: { draftKey?: string } = {}): Promise<SessionSnapshot> {
  const { db } = deps;
  const stored = getSession<SessionState>(db, sessionId);
  if (!stored) throw new Error(`unknown session ${sessionId}`);
  const session = normalized(stored);
  if (session.status !== 'active') return snapshot(db, session, deps.work);
  if (deps.work.current()?.status === 'running') throw new Error('Still working on your last answer.');
  const checked = checkExtras(deps, response);
  const state = session.state;
  const sent = { card: state.phase === 'teach' ? publicCard(state.card) : null, stage: state.phase === 'teach' ? state.stage : null, response: checked };
  const job = { kind: 'respond' as const, sessionId, goalId: state.goalId, sent, stoppable: answersQuestion(state) };
  // the renderer owns draft keys; only this session's can be dropped from here
  const dropDraft = () => {
    if (options.draftKey?.startsWith(`session:${sessionId}:`)) deleteDrafts(db, [options.draftKey]);
  };
  try {
    await deps.work.run(job, (gate) => respondTo(gate ? { ...deps, provider: gate.wrap(deps.provider) } : deps, session, checked));
  } catch (error) {
    // the answer was judged and saved before a later call failed: it must not be sent again
    if (getSession<SessionState>(db, sessionId)?.state.owed) dropDraft();
    throw error;
  }
  dropDraft();
  return snapshot(db, normalized(getSession<SessionState>(db, sessionId) as SessionRecord<SessionState>), deps.work);
}

/**
 * The renderer is not trusted with what reaches the model: attachments (and the plots of a code run)
 * must be names of stored files (at most four) and the quote and the code must fit. Empty extras are
 * dropped so stored answers stay plain.
 */
function checkExtras(deps: SessionDeps, response: LearnerResponse): LearnerResponse {
  const { attachments, quote, code, ...rest } = response;
  const parsed = ResponseExtrasSchema.safeParse({ attachments: attachments?.length ? attachments : undefined, quote: quote?.trim() ? quote : undefined, code: code?.source.trim() ? code : undefined });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'The attachments are not valid.');
  const extras = parsed.data;
  const stored = [...(extras.attachments ?? []), ...(extras.code?.run?.plots ?? [])];
  if (stored.length) {
    const dir = deps.attachmentsDir;
    if (!dir || !stored.every((name) => attachmentExists(dir, name))) throw new Error('An attached image was not saved. Attach it again.');
  }
  return { ...rest, ...(extras.attachments ? { attachments: extras.attachments } : {}), ...(extras.quote ? { quote: extras.quote } : {}), ...(extras.code ? { code: extras.code } : {}) };
}

/** A free recall or an answer to a graded card: the learner may stop it and edit. */
function answersQuestion(state: SessionState): boolean {
  if (state.phase === 'reconstruct' || state.phase === 'close') return true;
  return state.phase === 'teach' && state.stage !== null && isGraded(state.stage);
}

/**
 * Run one response. A model call can fail after the answer was judged and its evidence written (the
 * card after it, or the next idea's first card): then the state is saved up to that point with the
 * card owed, so the answer is never graded twice. Ideas finished are announced only once saved.
 */
export async function respondTo(deps: SessionDeps, session: SessionRecord<SessionState>, response: LearnerResponse): Promise<void> {
  const { db } = deps;
  const sessionId = session.id;
  const state = session.state;
  const finished: IdeaFinished[] = [];
  const announce = () => {
    for (const event of finished) deps.onIdeaFinished?.(event);
  };
  const eventsBefore = listSessionEvents(db, sessionId).length;
  try {
    await respondToPhase({ ...deps, onIdeaFinished: (event) => finished.push(event) }, session, response);
  } catch (error) {
    const written = listSessionEvents(db, sessionId).length > eventsBefore;
    if (!written || isCancelled(error) || state.phase !== 'teach' || state.card !== null) throw error;
    state.owed = true;
    saveSessionState(db, sessionId, state);
    announce();
    throw error;
  }
  announce();
}

async function respondToPhase(deps: SessionDeps, session: SessionRecord<SessionState>, response: LearnerResponse): Promise<void> {
  const { db } = deps;
  const sessionId = session.id;
  const state = session.state;
  const goal = tutorGoalFor(db, state);
  const goalText = goal.text;

  switch (state.phase) {
    case 'reconstruct': {
      const view = loadKnowledge(db);
      const nodes = state.previousNodes.map((n) => ({ id: n.id, name: n.name, statement: view.nodes.get(n.id)?.statement ?? '' })).filter((n) => view.nodes.has(n.id));
      if (nodes.length) {
        const recall = await runRecall(deps.provider, { goalText, nodes, text: response.answer, closing: false, opening: state.opening ?? undefined, quote: response.quote, images: imagesOf(deps, response) });
        for (const r of recall.recalled) {
          recordEvidence(db, { nodeId: r.nodeId, kind: 'recall', score: r.score, reasoning: r.note || 'free recall at session start', sessionId, context: { step: 'reconstruct' } });
        }
        appendSessionEvent(db, sessionId, 'reconstruct', { text: response.answer, recalled: recall.recalled, attachments: response.attachments, quote: response.quote, ...(state.opening ? { opening: state.opening } : {}) });
      }
      state.phase = 'orient';
      break;
    }
    case 'orient': {
      appendSessionEvent(db, sessionId, 'orient', {});
      await beginStep(deps, sessionId, state, 0, goal);
      break;
    }
    case 'teach': {
      const step = state.plan.steps[state.stepIndex];
      if (state.owed && step && state.stage) {
        await produceCard(deps, sessionId, state, step, state.stage, null, goal, true);
        state.owed = false;
        break;
      }
      await handleTeachResponse(deps, sessionId, state, response, goal);
      state.owed = false;
      break;
    }
    case 'practice': {
      const setId = state.practiceSetId;
      if (!setId) {
        state.phase = 'close';
        break;
      }
      if (state.practiceRevealed) {
        state.practiceRevealed = null;
        if (practiceView(db, setId).currentIndex === null) state.phase = 'close';
        break;
      }
      const view = practiceView(db, setId);
      const problem = view.currentIndex === null ? undefined : view.problems[view.currentIndex];
      if (!problem) {
        state.phase = 'close';
        break;
      }
      submitPracticeAnswer(deps, problem.id, response.answer, response.confidence ?? null, { code: response.code, attachments: response.attachments, quote: response.quote });
      state.practiceRevealed = problem.id;
      appendSessionEvent(db, sessionId, 'practice-answer', { setId, problemId: problem.id });
      break;
    }
    case 'close': {
      const view = loadKnowledge(db);
      const taught = state.plan.steps.filter((s) => state.nodeStatus[s.nodeId] === 'done');
      const nodes = taught.map((s) => ({ id: s.nodeId, name: s.name, statement: view.nodes.get(s.nodeId)?.statement ?? '' }));
      let closing: SessionState['closing'] = { canDo: 'Session complete.', previewQuestion: '', recall: [] };
      if (nodes.length) {
        const recall = await runRecall(deps.provider, { goalText, nodes, text: response.answer, closing: true, quote: response.quote, images: imagesOf(deps, response) });
        for (const r of recall.recalled) {
          recordEvidence(db, { nodeId: r.nodeId, kind: 'recall', score: r.score, reasoning: r.note || 'free recall at session close', sessionId, context: { step: 'close' } });
        }
        const names = new Map(nodes.map((n) => [n.id, n.name]));
        closing = { canDo: recall.canDo ?? '', previewQuestion: recall.previewQuestion ?? '', recall: recall.recalled.map((r) => ({ ...r, name: names.get(r.nodeId) ?? r.nodeId })) };
      }
      state.closing = closing;
      appendSessionEvent(db, sessionId, 'close', { text: response.answer, closing, attachments: response.attachments, quote: response.quote });
      state.phase = 'preview';
      state.card = null;
      state.stage = null;
      break;
    }
    case 'preview': {
      state.phase = 'done';
      saveSessionState(db, sessionId, state);
      endSession(db, sessionId, 'done');
      appendSessionEvent(db, sessionId, 'finish', {});
      logEvent(db, 'session.ended', { goalId: session.goalId, sessionId }, { status: 'done' });
      refreshGoalFields(db);
      await ingestTranscript(deps, sessionId, state);
      return;
    }
    case 'done':
      break;
  }
  saveSessionState(db, sessionId, state);
}

async function ingestTranscript(deps: SessionDeps, sessionId: string, state: SessionState): Promise<void> {
  if (!deps.ingestion || state.transcript.length === 0) return;
  const date = nowIso().slice(0, 10);
  const body = state.transcript.map((t) => `## ${t.nodeName} (${t.stage})\n\n${t.text}`).join('\n\n');
  const text = `# Session ${date}: ${state.plan.title}\n\nSession id: ${sessionId}\n\n${body}\n`;
  try {
    const { source, existed } = await deps.ingestion.addText({ kind: 'session', title: `Session ${date}: ${state.plan.title}`, text });
    if (!existed) deps.ingestion.start(source.id);
    appendSessionEvent(deps.db, sessionId, 'transcript', { sourceId: source.id });
  } catch (error) {
    appendSessionEvent(deps.db, sessionId, 'transcript-failed', { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * The learner asks the tutor something while a card is open (design §4.2): a question of their own,
 * or the explanation differently, simpler or as an example. The answer joins the conversation under
 * the card and the session's trail; nothing is graded and the card stays as it is. It runs as the
 * session's work, so an answer cannot be sent while the tutor is still replying.
 */
export async function askTutor(deps: SessionDeps, sessionId: string, input: { mode: AsideMode; question?: string }): Promise<SessionSnapshot> {
  const { db } = deps;
  const stored = getSession<SessionState>(db, sessionId);
  if (!stored) throw new Error(`unknown session ${sessionId}`);
  const session = normalized(stored);
  const state = session.state;
  const step = state.plan.steps[state.stepIndex];
  const stage = state.stage;
  const card = state.card;
  if (session.status !== 'active' || state.phase !== 'teach' || !step || !stage || !card) throw new Error('There is no card open to ask about.');
  const question = (input.question ?? '').trim();
  if (input.mode === 'question' && !question) throw new Error('Write your question first.');
  if (question.length > ASIDE_MAX_CHARS) throw new Error(`A question can be up to ${ASIDE_MAX_CHARS} characters.`);
  const earlier = openAsides(db, sessionId, step.nodeId, stage).filter((a) => a.mode === 'hint').map((a) => a.answer);
  if (input.mode === 'hint') {
    if (!HINT_STAGES.has(stage)) throw new Error('This step takes no hints.');
    if (earlier.length >= MAX_HINTS) throw new Error('There are no more hints for this question.');
  }
  await deps.work.run({ kind: 'respond', sessionId, goalId: state.goalId, sent: null, stoppable: false }, async () => {
    const goal = tutorGoalFor(db, state);
    const { previous: _previous, images: _images, cards: _cards, nextStage: _nextStage, ...context } = buildTutorInput(db, state, step, null, null, goal);
    const hint = input.mode === 'hint' ? { number: earlier.length + 1, of: MAX_HINTS, earlier } : undefined;
    const answer = await runTutorAside(deps.provider, { ...context, open: { stage, card, unanswered: isGraded(stage) }, mode: input.mode, question, hint, onWriting: (text) => deps.work.write(sessionId, text) });
    stillOpen(db, sessionId);
    appendSessionEvent(db, sessionId, 'aside', { nodeId: step.nodeId, stage, mode: input.mode, question, answer });
    // what the tutor said is taught material: it is read into the map with the rest, and the card writer sees it (a hint is not)
    if (input.mode !== 'hint') state.transcript.push({ nodeId: step.nodeId, nodeName: step.name, stage, text: answer });
    saveSessionState(db, sessionId, state);
  });
  return snapshot(db, normalized(getSession<SessionState>(db, sessionId) as SessionRecord<SessionState>), deps.work);
}
