/**
 * The teaching session (design §4): reconstruct → orient → teach each node with the step loop →
 * close → preview. State is persisted after every transition so the app can resume at the same card.
 */
import { passageFor } from '../core/passage';
import { FIGURE_STAGES, cardText, runRecall, runTutorStep, runTutorAside } from '../agents/tutor';
import type { Grade, LearnerResponse, TutorCard, TutorFigure, TutorGoal, TutorStepInput, AsideMode } from '../agents/tutor';
import { joinNames } from '../core/freeSession';
import { dependents, neighbourhood } from '../core/graph';
import { HINT_STAGES, IDEA_MAX_MINUTES, MAX_HINTS, SESSION_MAX_DEPTH, SIMPLE_AIM, applyGrade, certifyingStage, countedScore, emptyEdge, evidenceKindFor, ideaAllowance, isGraded, nextStage, normalizeEdge, stagesFor, testOutEdge, timebox } from '../core/session';
import type { EdgeState, Stage } from '../core/session';
import type { IdeaFinished } from '../core/cards';
import { PASS_SCORE } from '../core/types';
import type { Depth, Goal, GoalLevel } from '../core/types';
import { isCancelled, CancelledError } from '../llm/provider';
import type { LlmImage, LlmProvider } from '../llm/provider';
import { ResponseExtrasSchema } from '../core/attachments';
import { attachmentExists, readAttachment } from '../store/attachments';
import { figuresForNode, getFigure } from '../store/figures';
import type { Database } from '../store/db';
import { nowIso } from '../store/db';
import { listBugsForNode } from '../store/bugs';
import { afterAnswer } from './bugs';
import { logEvent, secondsOnNode } from '../store/activity';
import { getState } from '../store/evidence';
import { getGoal, listTargets } from '../store/goals';
import { activeSession, appendSessionEvent, createSession, endSession, getSession, listEndedSessions, listSessionEvents, saveSessionState } from '../store/sessions';
import type { SessionRecord } from '../store/sessions';
import { deleteDrafts } from '../store/drafts';
import { chunksCoveringNode, getSource } from '../store/sources';
import { listExamplesForNode } from '../store/world';
import { cardsToJudge, creditRecalledCards } from './cards';
import { recordEvidence, setOwnStatement } from './evidence';
import { simplifyIdea } from './goals';
import { noteBackgroundGaps } from './remap';
import type { IngestionService } from './ingestion';
import { loadKnowledge, refreshGoalFields } from './knowledge';
import type { KnowledgeView } from './knowledge';
import { MAX_PLAN_NODES, candidatesForGoal, planFocusSession, planSession } from './planner';
import { practiceView, startPractice, submitPracticeAnswer } from './practice';
import type { PracticeDeps, PracticeView } from './practice';
import type { LessonPlan, LessonStep } from './planner';
import type { SessionWork, SessionWorkView } from './sessionWork';

export type Phase = 'reconstruct' | 'orient' | 'teach' | 'practice' | 'close' | 'preview' | 'done';
export type NodeStatus = 'pending' | 'active' | 'done';

export interface NodeHistoryEntry {
  stage: Stage;
  card: TutorCard;
  response: LearnerResponse | null;
  grade: Grade | null;
}

export interface SessionState {
  /** The goal whose frame the tutor uses; null for a free session with no goal. */
  goalId: string | null;
  plan: LessonPlan;
  phase: Phase;
  stepIndex: number;
  stage: Stage | null;
  /** The stage a support card interrupted; the loop resumes after it. */
  supportAfter: Stage | null;
  card: TutorCard | null;
  edge: EdgeState;
  nodeStatus: Record<string, NodeStatus>;
  history: Record<string, NodeHistoryEntry[]>;
  transcript: { nodeId: string; nodeName: string; stage: Stage; text: string }[];
  previousNodes: { id: string; name: string }[];
  closing: { canDo: string; previewQuestion: string; recall: { nodeId: string; name: string; score: number; note: string }[] } | null;
  pendingEffort: number | null;
  /** A half-done idea carried over from an ended session; restored when its step begins. Absent in older states. */
  resume?: ResumePoint | null;
  /** The compound practice set run after the last idea, when anything was fading. */
  practiceSetId?: string | null;
  /** The practice problem whose solution is showing; the next response moves on. */
  practiceRevealed?: string | null;
  /** Minutes an idea carried over from an ended session already had there; they count toward its half hour. */
  priorMinutes?: Record<string, number>;
  /** A session the learner chose (design §4.5); absent for planned sessions. */
  free?: FreeSession | null;
  /**
   * The answer before was judged and saved, but writing the card for `stage` failed: the next
   * response only writes that card, so nothing is graded or recorded twice.
   */
  owed?: boolean;
  /** A session on a goal whose ideas the learner chose (going deeper): no recall, no practice, and the goal's planned sessions do not carry from it. */
  chosen?: boolean;
}

/** What the learner chose: their words or their ideas, how deep, and where the time is booked. */
export interface FreeSession {
  /** What they asked for in their words, or null when they picked ideas. */
  description: string | null;
  /** The ideas they picked, by name (empty for a description). */
  picked: string[];
  /** The session's time counts toward its goal; otherwise it is free study. */
  counted: boolean;
  level: GoalLevel;
}

/** Where the learner stopped inside an idea: the open card and the loop state around it. */
export interface ResumePoint {
  nodeId: string;
  fromSessionId: string;
  stage: Stage;
  card: TutorCard;
  supportAfter: Stage | null;
  edge: EdgeState;
  pendingEffort: number | null;
  history: NodeHistoryEntry[];
}

/** What the renderer sees. Answer keys and rubrics never leave the backend. */
export interface SessionSnapshot {
  id: string;
  goalId: string | null;
  goalText: string;
  /** The goal's short name for the breadcrumb (its sentence until compiled); "Free study" with no goal. */
  goalTitle: string;
  /** What the learner asked for, in a session they chose. */
  free: Pick<FreeSession, 'description' | 'picked' | 'counted'> | null;
  /** The last answer was saved but the next card could not be written; "Try again" writes it. */
  owed: boolean;
  startedAt: string;
  status: SessionRecord['status'];
  phase: Phase;
  plan: { title: string; orientation: string; steps: (LessonStep & { status: NodeStatus })[] };
  current: {
    nodeId: string;
    name: string;
    why: string;
    /** The depth this session takes the idea to. */
    aim: Depth;
    /** Why the idea was simplified (taught as its core intuition); null when it was not. */
    simplified: string | null;
    /** A one-line note on the idea's half hour, when it is wrapping up. */
    note: string | null;
    /** "I know this, test me" is offered: a prediction or explanation, with a deeper question to jump to. */
    canTestOut: boolean;
    stage: Stage;
    stages: Stage[];
    stageIndex: number;
    stageCount: number;
    /** Where the idea sits in today's plan, counting from 1, and how many ideas the plan has. */
    position: number;
    planned: number;
    /** Minutes spent on the idea so far and the minutes it gets at most (its half hour, or less). */
    minutesUsed: number;
    minutesAllowed: number;
    /** Hints the learner can still take on the open question; 0 when it takes none. */
    hintsLeft: number;
  } | null;
  card: PublicCard | null;
  /** What the learner asked the tutor about the open card, oldest first. */
  asides: Aside[];
  previousNodes: { id: string; name: string }[];
  closing: SessionState['closing'];
  /** Everything already said in this session, oldest first, rebuilt from session events. */
  history: SessionHistory;
  /** The ideas around the current one, for the side panel map. */
  frontier: FrontierMap | null;
  /** Compound practice inside the session, once it has started. */
  practice: PracticeView | null;
  /** The practice problem whose solution is showing, waiting for "Next". */
  practiceRevealed: string | null;
  /** An answer still being judged (or one that failed), so the screen shows it as sent after leaving and coming back. */
  work: SessionWorkView | null;
}

/** Something the learner asked the tutor while a card was open, and what the tutor said. Not graded. */
export interface Aside {
  id: string;
  mode: AsideMode;
  /** The learner's own words; empty when they asked for the explanation in another form. */
  question: string;
  answer: string;
}

/** The longest question the learner can ask the tutor, in characters. */
export const ASIDE_MAX_CHARS = 2000;

/** One answered step: the card as shown, the learner's answer exactly as given, the rating. */
export interface HistoryItem {
  id: string;
  stage: Stage;
  card: PublicCard;
  /** What the learner asked the tutor while this card was open. */
  asides: Aside[];
  response: LearnerResponse | null;
  grade: Grade | null;
  /** True for steps answered in an earlier session and carried over with a half-done idea. */
  carried: boolean;
}

export interface HistoryNode {
  nodeId: string;
  name: string;
  status: NodeStatus;
  /** Mean score of the graded steps, or null when nothing was graded yet. */
  score: number | null;
  items: HistoryItem[];
}

export interface SessionHistory {
  /** The free recall at the start of the session, when there was one. */
  reconstruct: { text: string; recalled: { nodeId: string; name: string; score: number; note: string }[]; attachments?: string[]; quote?: string } | null;
  nodes: HistoryNode[];
}

export type FrontierState = 'owned' | 'learnable' | 'current' | 'beyond';

export interface FrontierMap {
  nodes: { id: string; name: string; state: FrontierState }[];
  edges: [string, string][];
  /** How many ideas the goal has on the learner's edge right now. */
  edgeCount: number;
}

const FRONTIER_SIZE = 12;
const SESSION_PRACTICE_PROBLEMS = 2;

export type PublicCard =
  | { stage: 'predict' | 'connect' | 'compress'; prompt: string }
  | { stage: 'explain' | 'support' | 'reteach'; markdown: string }
  | { stage: 'check'; question: string }
  | { stage: 'derive'; prompt: string }
  | { stage: 'use'; task: string }
  | { stage: 'index'; gist: string; placement: string; question: string };

export interface SessionDeps extends Pick<PracticeDeps, 'onGraded' | 'onError'> {
  db: Database;
  provider: LlmProvider;
  /** When present, the tutor's prose is ingested as a source after the session. */
  ingestion?: IngestionService;
  /** Where answer images are stored; needed only when a response attaches any. */
  attachmentsDir?: string;
  /** Where the pictures of picture pages are kept; without it the tutor gets figures by description only. */
  figuresDir?: string;
  /** The work in flight, which keeps running when the Session screen closes. */
  work: SessionWork;
  /** Told when an idea is finished, so its flashcards can be written in the background. */
  onIdeaFinished?: (event: IdeaFinished) => void;
}

export function currentSession(db: Database, work?: SessionWork): SessionSnapshot | null {
  const session = activeSession<SessionState>(db);
  return session ? snapshot(db, normalized(session), work) : null;
}

/**
 * Sessions saved before R3 planned steps by mode (index, teach, derive) and counted easy answers; read
 * them as aims and strong answers so they resume where they were.
 */
function normalized(session: SessionRecord<SessionState>): SessionRecord<SessionState> {
  type OldStep = LessonStep & { mode?: 'index' | 'teach' | 'derive' };
  const steps = session.state.plan.steps.map((st: OldStep) => {
    if (st.aim !== undefined) return st;
    const aim: Depth = st.mode === 'index' ? 1 : st.mode === 'derive' ? 3 : 2;
    return { ...st, aim, fromDepth: 0 as Depth, minutes: IDEA_MAX_MINUTES, simplified: null };
  });
  return { ...session, state: { ...session.state, plan: { ...session.state.plan, steps }, edge: normalizeEdge(session.state.edge) } };
}

/**
 * Open a session on the goal (or return the open one). `focus`: a session the learner chose, going
 * deeper on those ideas. Planning runs as the session's work, so it goes on when the screen closes.
 */
export async function startSession(deps: SessionDeps, goalId: string, focus?: string[]): Promise<SessionSnapshot> {
  const { db } = deps;
  const active = activeSession<SessionState>(db);
  if (active) return snapshot(db, normalized(active), deps.work);
  const sessionId = await deps.work.run({ kind: 'start', sessionId: null, goalId, sent: null, stoppable: false }, () => openGoalSession(deps, goalId, focus), (id) => id);
  return snapshot(db, getSession<SessionState>(db, sessionId) as SessionRecord<SessionState>, deps.work);
}

async function openGoalSession(deps: SessionDeps, goalId: string, focus: string[] | undefined): Promise<string> {
  const { db } = deps;
  const goal = getGoal(db, goalId);
  if (!goal) throw new Error(`unknown goal ${goalId}`);
  // only the goal's own planned sessions carry a half-done idea or are recalled: a chosen session
  // counted toward the goal is stored under it too, and must not hide the planned one before it
  const ended = listEndedSessions<SessionState>(db, goalId).map(normalized).filter((s) => !s.state.free && !s.state.chosen);
  const view = loadKnowledge(db);
  // an idea erased from the map since has nothing left to carry, so it counts as reached
  const carried = ended[0] && !focus?.length ? carriedPlace(ended[0], (id, depth) => !view.nodes.has(id) || ((view.states.get(id)?.depth ?? 0) >= depth && (depth < 2 || view.owned.has(id)))) : null;
  const planned = focus?.length ? planFocusSession(db, goalId, focus) : await planSession(db, deps.provider, goalId, { maxNodes: carried ? MAX_PLAN_NODES - 1 : MAX_PLAN_NODES, reservedMinutes: carried?.step.minutes ?? 0 });
  const plan = carried ? withCarriedStep(planned, carried.step) : planned;
  if (plan.steps.length === 0) throw new Error(`Nothing to teach for this goal yet: ${plan.orientation}`);
  // a session the learner chose (going deeper) is about those ideas: no recall of the last planned session
  const previousNodes = focus?.length ? [] : previouslyTaughtNodes(ended);
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
 */
export async function abandonSession(deps: SessionDeps, sessionId: string): Promise<void> {
  const { db } = deps;
  const session = getSession<SessionState>(db, sessionId);
  if (!session || session.status !== 'active') return;
  // an answer still being judged is stopped if it can be; if not, the work stops itself at its next step (stillOpen)
  deps.work.cancel(sessionId);
  endSession(db, sessionId, 'abandoned');
  deps.work.forget(sessionId);
  appendSessionEvent(db, sessionId, 'abandon', {});
  logEvent(db, 'session.ended', { goalId: session.goalId, sessionId }, { status: 'abandoned' });
  refreshGoalFields(db);
  await ingestTranscript(deps, sessionId, session.state);
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
 * The renderer is not trusted with what reaches the model: attachments must be names of stored
 * files (at most four) and the quote must fit. Empty extras are dropped so stored answers stay plain.
 */
function checkExtras(deps: SessionDeps, response: LearnerResponse): LearnerResponse {
  const { attachments, quote, ...rest } = response;
  const parsed = ResponseExtrasSchema.safeParse({ attachments: attachments?.length ? attachments : undefined, quote: quote?.trim() ? quote : undefined });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'The attachments are not valid.');
  const extras = parsed.data;
  if (extras.attachments) {
    const dir = deps.attachmentsDir;
    if (!dir || !extras.attachments.every((name) => attachmentExists(dir, name))) throw new Error('An attached image was not saved. Attach it again.');
  }
  return { ...rest, ...(extras.attachments ? { attachments: extras.attachments } : {}), ...(extras.quote ? { quote: extras.quote } : {}) };
}

/** Figures whose pictures go with a call that writes an explaining card: the first two the idea has. */
const FIGURE_PICTURES = 2;

function figureImagesOf(deps: SessionDeps, figures: TutorFigure[]): LlmImage[] | undefined {
  const dir = deps.figuresDir;
  if (!dir || figures.length === 0) return undefined;
  const images: LlmImage[] = [];
  for (const figure of figures.slice(0, FIGURE_PICTURES)) {
    const stored = getFigure(deps.db, figure.id);
    if (!stored?.file) break;
    try {
      images.push(readAttachment(dir, stored.file));
    } catch {
      // a picture file that went missing: the tutor goes by the description, and the order still matches
      break;
    }
  }
  return images.length ? images : undefined;
}

/** The images of the response being judged, read from disk for the model call. */
function imagesOf(deps: SessionDeps, response: LearnerResponse): LlmImage[] | undefined {
  const dir = deps.attachmentsDir;
  if (!response.attachments?.length || !dir) return undefined;
  return response.attachments.map((name) => readAttachment(dir, name));
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
async function respondTo(deps: SessionDeps, session: SessionRecord<SessionState>, response: LearnerResponse): Promise<void> {
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
        const recall = await runRecall(deps.provider, { goalText, nodes, text: response.answer, closing: false, quote: response.quote, images: imagesOf(deps, response) });
        for (const r of recall.recalled) {
          recordEvidence(db, { nodeId: r.nodeId, kind: 'recall', score: r.score, reasoning: r.note || 'free recall at session start', sessionId, context: { step: 'reconstruct' } });
        }
        appendSessionEvent(db, sessionId, 'reconstruct', { text: response.answer, recalled: recall.recalled, attachments: response.attachments, quote: response.quote });
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
      submitPracticeAnswer(deps, problem.id, response.answer, response.confidence ?? null);
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

/**
 * Compound practice after the last idea (design §4.1 step 5): up to two problems over the goal's
 * fading ideas, not the ones just taught. A failed generation skips practice rather than the close.
 */
async function startSessionPractice(deps: SessionDeps, sessionId: string, state: SessionState): Promise<boolean> {
  if (state.practiceSetId !== undefined && state.practiceSetId !== null) return true;
  // a session the learner chose is about what they asked; a goal's fading ideas wait for its own sessions
  if (state.free || state.chosen || !state.goalId) return false;
  try {
    const set = await startPractice(deps, state.goalId, { sessionId, maxProblems: SESSION_PRACTICE_PROBLEMS, exclude: state.plan.steps.map((s) => s.nodeId) });
    state.practiceSetId = set?.id ?? null;
    if (set) appendSessionEvent(deps.db, sessionId, 'practice-start', { setId: set.id, problems: set.problems.length });
    return set !== null;
  } catch (error) {
    appendSessionEvent(deps.db, sessionId, 'practice-failed', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

async function beginStep(deps: SessionDeps, sessionId: string, state: SessionState, index: number, goal: TutorGoal, afterOutcome = false): Promise<void> {
  state.stepIndex = index;
  state.edge = emptyEdge();
  state.supportAfter = null;
  state.pendingEffort = null;
  const step = state.plan.steps[index];
  if (!step) {
    state.stage = null;
    state.card = null;
    state.owed = false;
    // saved as closing first: if the app quits while practice problems are written, the session reopens at its close
    state.phase = 'close';
    if (afterOutcome) saveSessionState(deps.db, sessionId, state);
    if (await startSessionPractice(deps, sessionId, state)) state.phase = 'practice';
    return;
  }
  state.phase = 'teach';
  state.nodeStatus[step.nodeId] = 'active';
  const resume = state.resume;
  if (resume && resume.nodeId === step.nodeId) {
    state.stage = resume.stage;
    state.card = resume.card;
    state.supportAfter = resume.supportAfter;
    state.edge = normalizeEdge(resume.edge);
    state.pendingEffort = resume.pendingEffort;
    state.history[step.nodeId] = resume.history;
    state.resume = null;
    state.owed = false;
    appendSessionEvent(deps.db, sessionId, 'resume', { nodeId: step.nodeId, stage: resume.stage, fromSessionId: resume.fromSessionId });
    return;
  }
  const first = stepStages(step)[0] as Stage;
  await produceCard(deps, sessionId, state, step, first, null, goal, afterOutcome);
}

/** The step loop for a step: fitted to its aim, from the depth it started at. */
function stepStages(step: LessonStep): Stage[] {
  return stagesFor(step.aim, step.fromDepth);
}

/** Ask the tutor for the card of `stage` (grading `previous` in the same call when given) and show it. */
async function produceCard(
  deps: SessionDeps,
  sessionId: string,
  state: SessionState,
  step: LessonStep,
  stage: Stage,
  previous: TutorStepInput['previous'],
  goal: TutorGoal,
  /**
   * True when an answer was already judged and written before this call. The session is then saved
   * first as owing this card, so a quit or a crash during the call reopens it at "the answer is saved,
   * the next card is not written yet" and never at the card that was answered (which would grade it twice).
   */
  afterOutcome = false,
  /** The card asks again, in a fresh version, a question the learner just missed. */
  retry = false,
): Promise<Grade | null> {
  // on failure, where the session stands if what came before this call is kept (see respondTo)
  const owe = (error: unknown): never => {
    state.stage = stage;
    state.card = null;
    throw error;
  };
  if (afterOutcome) {
    state.stage = stage;
    state.card = null;
    state.owed = true;
    saveSessionState(deps.db, sessionId, state);
  }
  const input = buildTutorInput(deps.db, state, step, previous, stage, goal);
  const result = await runTutorStep(deps.provider, { ...input, images: previous ? imagesOf(deps, previous.response) : undefined, figureImages: FIGURE_STAGES.has(stage) ? figureImagesOf(deps, input.figures) : undefined, retry }).catch(owe);
  stillOpen(deps.db, sessionId);
  if (!result.card) return owe(new Error('the tutor returned no card'));
  state.stage = stage;
  state.card = result.card;
  state.owed = false;
  pushHistory(state, step.nodeId, { stage, card: result.card, response: null, grade: null });
  if (result.card.stage === 'explain' || result.card.stage === 'support' || result.card.stage === 'reteach') state.transcript.push({ nodeId: step.nodeId, nodeName: step.name, stage, text: result.card.markdown });
  if (result.card.stage === 'index') state.transcript.push({ nodeId: step.nodeId, nodeName: step.name, stage, text: `${result.card.gist}\n\n${result.card.placement}` });
  appendSessionEvent(deps.db, sessionId, 'card', { nodeId: step.nodeId, stage, card: result.card });
  return result.grade;
}

async function handleTeachResponse(deps: SessionDeps, sessionId: string, state: SessionState, response: LearnerResponse, goal: TutorGoal): Promise<void> {
  const { db } = deps;
  const step = state.plan.steps[state.stepIndex];
  const stage = state.stage;
  const card = state.card;
  if (!step || !stage || !card) throw new Error('no card to respond to');
  const stages = stepStages(step);

  // "I know this, test me": the question that shows the aim decides, with no explanation first
  if (response.testMe && canTestOut(step, stage, state.edge)) {
    state.edge = testOutEdge(state.edge, stage);
    finishHistory(state, step.nodeId, stage, response, null);
    await produceCard(deps, sessionId, state, step, certifyingStage(step.aim), null, goal);
    appendSessionEvent(db, sessionId, 'response', { nodeId: step.nodeId, stage, response });
    return;
  }

  if (!isGraded(stage)) {
    // explain / support / reteach: the learner read it; an effort rating may ride along to the next evidence
    if (response.effort !== undefined) state.pendingEffort = response.effort;
    finishHistory(state, step.nodeId, stage, response, null);
    appendSessionEvent(db, sessionId, 'response', { nodeId: step.nodeId, stage, response });
    const resumeFrom = stage === 'support' || stage === 'reteach' ? (state.supportAfter ?? stage) : stage;
    state.supportAfter = null;
    const next = nextStage(stages, resumeFrom, 'none');
    await advance(deps, sessionId, state, step, next, null, goal, true);
    return;
  }

  const nominalNext = nextStage(stages, stage, 'none');
  const previous = { stage, card, response };
  let grade: Grade | null;
  if (nominalNext) {
    grade = await produceCard(deps, sessionId, state, step, nominalNext, previous, goal);
  } else {
    const result = await runTutorStep(deps.provider, { ...buildTutorInput(db, state, step, previous, null, goal), images: imagesOf(deps, response) });
    grade = result.grade;
    stillOpen(db, sessionId);
  }
  if (!grade) throw new Error('the tutor returned no grade');
  // an answer given with hints is not an unaided one: it counts for less, in the evidence and in what comes next
  const hints = hintsTaken(openAsides(db, sessionId, step.nodeId, stage));
  const counted = countedScore(grade.score, hints);
  finishHistory(state, step.nodeId, stage, response, grade);
  appendSessionEvent(db, sessionId, 'response', { nodeId: step.nodeId, stage, response, grade, ...(hints ? { hints } : {}) });
  writeOutcome(db, sessionId, state, step, stage, response, grade, counted, hints);
  // The answer is judged and written. From here on a quit or a crash must never bring the answered
  // card back: with no next card yet (the idea's last step) the session is saved as owing one.
  if (state.card === card) {
    state.card = null;
    state.owed = true;
  }
  saveSessionState(db, sessionId, state);

  const { edge, action } = applyGrade(state.edge, { score: counted, confidence: response.confidence, stage, aim: step.aim });
  state.edge = edge;
  if (action === 'support' || action === 'escalate') {
    state.supportAfter = stage;
    await produceCard(deps, sessionId, state, step, action === 'support' ? 'support' : 'reteach', null, goal, true);
    return;
  }

  // the idea's half hour (design §4.3); a missing foundation is also noted for the goal's map
  const missing = stage !== 'predict' && counted < PASS_SCORE && grade.missingBackground !== null;
  // a chosen session's gaps are about what the learner asked, not about the goal's map
  if (missing && grade.missingBackground && state.goalId && !state.free) noteBackgroundGaps(db, state.goalId, [grade.missingBackground], 'session');
  const box = action === 'done' ? 'none' : timebox({ minutes: minutesOn(db, state, sessionId, step.nodeId), allowance: ideaAllowance(step.minutes), aim: step.aim, simplified: step.simplified !== null, edge, missingBackground: missing });
  if (box === 'simplify') {
    const reason = missing && grade.missingBackground ? `It needs ${grade.missingBackground.name}, which this goal's time does not also cover` : 'It was taking longer than its half hour allows';
    simplifyStep(db, state, step, SIMPLE_AIM, reason);
    // start again from a plain explanation of the core idea; the loop goes on from there
    state.edge = { ...state.edge, consecutiveFailures: 0, jumpedFrom: null };
    await produceCard(deps, sessionId, state, step, 'explain', null, goal, true);
    return;
  }
  if (box === 'wrapUp') state.edge = { ...state.edge, wrapping: true };
  // a missed question comes once more in a fresh version (the feedback just said what was missing), unless the idea's time is up
  if (action === 'retry' && box === 'none') {
    await produceCard(deps, sessionId, state, step, stage, null, goal, true, true);
    return;
  }
  const next = box === 'wrapUp' ? nextStage(stepStages(step), stage, 'wrapUp') : nextStage(stepStages(step), stage, action, edge, step.aim);
  // a failed test-out goes back to teaching once; after that, a miss on the same question is an
  // ordinary miss (it counts toward the worked example) instead of sending the learner round again
  if (action === 'resume') state.edge = { ...state.edge, jumpedFrom: null };
  if (next === nominalNext) {
    if (next === null) await advance(deps, sessionId, state, step, null, null, goal, true);
    return; // the card for `next` is already showing
  }
  await advance(deps, sessionId, state, step, next, null, goal, true);
}

/** "I know this, test me" applies to a prediction or explanation with a deeper question still ahead. */
function canTestOut(step: LessonStep, stage: Stage, edge: EdgeState): boolean {
  if (step.aim < 2 || edge.jumpedFrom || (stage !== 'predict' && stage !== 'explain')) return false;
  const stages = stepStages(step);
  return stages.indexOf(certifyingStage(step.aim)) > stages.indexOf(stage);
}

/** Minutes the learner has spent on this idea: in this session, plus what a carried-over idea had before. */
function minutesOn(db: Database, state: SessionState, sessionId: string, nodeId: string): number {
  return secondsOnNode(db, [sessionId], nodeId) / 60 + (state.priorMinutes?.[nodeId] ?? 0);
}

/**
 * Simplify the step's idea for the goal (capped at `depth`, with the reason), and follow the caps
 * through the rest of today's plan: dependents planned deeper are capped to explaining.
 */
function simplifyStep(db: Database, state: SessionState, step: LessonStep, depth: Depth, reason: string, options: { dependents: boolean } = { dependents: true }): void {
  // a chosen session simplifies only itself: the goal's plan is the goal's sessions' business
  const changed = state.goalId && !state.free ? simplifyIdea(db, state.goalId, step.nodeId, depth, reason, options) : new Map<string, Depth>([[step.nodeId, depth]]);
  for (const st of state.plan.steps) {
    const cap = changed.get(st.nodeId);
    if (cap === undefined) continue;
    if (state.nodeStatus[st.nodeId] !== 'done') st.aim = Math.min(st.aim, cap) as Depth;
    st.simplified = st.simplified ?? (st.nodeId === step.nodeId ? reason : `Simplified with ${step.name}`);
  }
}

/**
 * Move to `next` within the node (producing its card) or finish the node and begin the next step. An
 * idea that ends below its aim (its half hour ran out, or it never came together) is kept at the depth
 * it reached and marked simplified, so the plan stops counting on more and the learner can go deeper later.
 */
async function advance(deps: SessionDeps, sessionId: string, state: SessionState, step: LessonStep, next: Stage | null, previous: TutorStepInput['previous'], goal: TutorGoal, afterOutcome = false): Promise<void> {
  if (next === null) {
    const reached = getState(deps.db, step.nodeId)?.depth ?? 0;
    // a session certifies up to applying; transfer comes from practice later, so it is never "missed" here.
    // The idea alone is held at what was reached: the ideas built on it are capped only when it had to be simplified.
    const asked = Math.min(step.aim, SESSION_MAX_DEPTH);
    if (asked >= 2 && reached < asked) {
      simplifyStep(deps.db, state, step, Math.max(1, reached) as Depth, `Learned to ${DEPTH_WORD[reached] ?? 'a first look'} within its half hour; the plan asked ${DEPTH_WORD[step.aim] ?? 'more'}`, { dependents: false });
    }
    state.nodeStatus[step.nodeId] = 'done';
    appendSessionEvent(deps.db, sessionId, 'node-done', { nodeId: step.nodeId });
    deps.onIdeaFinished?.(ideaFinished(sessionId, state, step));
    await beginStep(deps, sessionId, state, state.stepIndex + 1, goal, afterOutcome);
    return;
  }
  await produceCard(deps, sessionId, state, step, next, previous, goal, afterOutcome);
}

/** The session was ended while its work was running: nothing more is written to it. */
function stillOpen(db: Database, sessionId: string): void {
  if (getSession(db, sessionId)?.status !== 'active') throw new CancelledError();
}

/** What the card writer reads about an idea the session just finished: what was taught and how the learner answered. */
function ideaFinished(sessionId: string, state: SessionState, step: LessonStep): IdeaFinished {
  return {
    sessionId,
    goalId: state.goalId,
    nodeId: step.nodeId,
    taught: state.transcript.filter((t) => t.nodeId === step.nodeId).map((t) => t.text),
    answers: (state.history[step.nodeId] ?? []).flatMap((h) => (h.response && isGraded(h.stage) ? [{ question: cardText(h.card), answer: h.response.answer, score: h.grade?.score ?? null }] : [])),
  };
}

const DEPTH_WORD = ['a first look', 'recognizing it', 'explaining it', 'deriving it', 'applying it', 'transferring it'];

/** What the tutor needs to know about the goal: its sentence and how the time reads it. */
function tutorGoal(goal: Goal | undefined): TutorGoal {
  return { text: goal?.text ?? '', level: goal?.level ?? null, scope: goal?.scope ?? null, assessment: goal?.assessment ?? 'none', focus: goal?.focus ?? [], context: goal?.context ?? null };
}

/**
 * The goal frame for a session. A chosen one adds what the learner asked to its goal's frame, at the
 * session's level; with no goal, what was asked is the goal, studied for its own sake.
 */
function tutorGoalFor(db: Database, state: SessionState): TutorGoal {
  const goal = state.goalId ? getGoal(db, state.goalId) : undefined;
  const free = state.free;
  if (!free) return tutorGoal(goal);
  const asked = free.description ? `The learner asked for this session: "${free.description}"` : `The learner chose to learn ${joinNames(free.picked)} now.`;
  if (goal) return { ...tutorGoal(goal), text: `${goal.text}\n\n${asked}`, level: free.level };
  return { text: asked, level: free.level, scope: null, assessment: 'none', focus: [], context: null };
}

function writeOutcome(db: Database, sessionId: string, state: SessionState, step: LessonStep, stage: Stage, response: LearnerResponse, grade: Grade, counted = grade.score, hints = 0): void {
  const kind = evidenceKindFor(stage);
  if (kind) {
    recordEvidence(db, {
      nodeId: step.nodeId,
      kind,
      score: counted,
      reasoning: grade.feedback,
      confidence: response.confidence ?? null,
      effort: state.pendingEffort ?? response.effort ?? null,
      sessionId,
      context: hints ? { step: stage, hints } : { step: stage },
    });
    state.pendingEffort = null;
  }
  if (stage === 'compress' && response.answer.trim()) setOwnStatement(db, step.nodeId, response.answer.trim(), response.handle?.trim() || null);
  if (stage === 'connect' && grade.score >= 0.7 && response.answer.trim()) {
    state.transcript.push({ nodeId: step.nodeId, nodeName: step.name, stage, text: `Link the learner stated and the tutor confirmed: ${response.answer.trim()}` });
  }
  afterAnswer(db, step.nodeId, grade.misconception ?? null);
  creditRecalledCards(db, grade.recalledCards, { source: 'session', sessionId });
}

/** Figures the tutor is told about for one idea. */
const MAX_FIGURES = 4;

function buildTutorInput(db: Database, state: SessionState, step: LessonStep, previous: TutorStepInput['previous'], nextStage: Stage | null, goal: TutorGoal): TutorStepInput {
  const view = loadKnowledge(db);
  const node = view.nodes.get(step.nodeId);
  if (!node) throw new Error(`unknown node ${step.nodeId}`);
  const simplified = new Set(state.goalId ? listTargets(db, state.goalId, { all: true }).filter((t) => t.simplified).map((t) => t.nodeId) : []);
  const premiseIds = new Set<string>();
  for (const chain of view.index.into.get(node.id) ?? []) for (const p of chain.premises) premiseIds.add(p);
  const premises = [...premiseIds].map((id) => {
    const p = view.nodes.get(id);
    const s = getState(db, id);
    return { name: p?.name ?? id, statement: p?.statement ?? '', owned: view.owned.has(id), ownStatement: s?.ownStatement ?? null, handle: s?.handle ?? null, simplified: simplified.has(id) };
  });
  const deps = [...dependents(node.id, view.index, 1, 1).keys()].map((id) => ({ name: view.nodes.get(id)?.name ?? id }));
  return {
    goal,
    why: step.why,
    node: { id: node.id, kind: node.kind, name: node.name, statement: node.statement },
    aim: step.aim,
    simplified: step.simplified,
    premises,
    dependents: deps,
    bugs: listBugsForNode(db, node.id).map((b) => b.description),
    examples: listExamplesForNode(db, node.id).map((e) => ({ title: e.title, locator: `${getSource(db, e.sourceId)?.title ?? 'source'}, ${e.locator}`, body: e.body })),
    // the page that teaches the idea (its citation), not the first page of the source it is in
    excerpts: chunksCoveringNode(db, node.id).map((c) => {
      const cited = node.sources.find((ref) => ref.sourceId === c.sourceId)?.locator;
      return { locator: `${c.sourceTitle}, ${cited ?? c.locator}`, text: passageFor(c.text, cited, node.name) };
    }),
    figures: figuresForNode(db, node.id)
      .slice(0, MAX_FIGURES)
      .map((f) => ({ id: f.id, where: `${f.sourceTitle}, ${f.locator}`, shows: f.caption ?? 'A figure from the material.' })),
    history: (state.history[node.id] ?? []).filter((h) => h.response !== null || h.grade !== null),
    previous,
    cards: previous && isGraded(previous.stage) ? cardsToJudge(db, [node.id, ...premiseIds]) : [],
    nextStage,
  };
}

function pushHistory(state: SessionState, nodeId: string, entry: NodeHistoryEntry): void {
  const list = state.history[nodeId] ?? [];
  list.push(entry);
  state.history[nodeId] = list;
}

function finishHistory(state: SessionState, nodeId: string, stage: Stage, response: LearnerResponse, grade: Grade | null): void {
  const list = state.history[nodeId] ?? [];
  const last = [...list].reverse().find((h) => h.stage === stage && h.response === null);
  if (last) {
    last.response = response;
    last.grade = grade;
  }
}

/** The finished ideas of the most recent ended session (done or ended early) that finished any. */
function previouslyTaughtNodes(ended: SessionRecord<SessionState>[]): { id: string; name: string }[] {
  for (const session of ended) {
    const done = session.state.plan.steps.filter((s) => session.state.nodeStatus[s.nodeId] === 'done').map((s) => ({ id: s.nodeId, name: s.name }));
    if (done.length) return done;
  }
  return [];
}

/**
 * The half-done idea of a session that was ended early: the idea being taught when it ended, or one
 * it had carried over itself and not reached yet. Nothing carries once the idea is owned at its target depth.
 */
export function carriedPlace(session: SessionRecord<SessionState>, reached: (nodeId: string, targetDepth: number) => boolean): { step: LessonStep; resume: ResumePoint } | null {
  // a chosen session's half-done idea is not the goal's plan, so its planned sessions do not carry it
  if (session.status !== 'abandoned' || session.state.free || session.state.chosen) return null;
  const s = session.state;
  let resume: ResumePoint | null = null;
  const step = s.plan.steps[s.stepIndex];
  if (s.phase === 'teach' && step && s.stage && s.card) {
    resume = { nodeId: step.nodeId, fromSessionId: session.id, stage: s.stage, card: s.card, supportAfter: s.supportAfter, edge: s.edge, pendingEffort: s.pendingEffort, history: s.history[step.nodeId] ?? [] };
  } else if (s.resume) {
    resume = { ...s.resume, fromSessionId: session.id };
  }
  if (!resume) return null;
  const carriedStep = s.plan.steps.find((st) => st.nodeId === resume.nodeId);
  return carriedStep && !reached(carriedStep.nodeId, carriedStep.aim) ? { step: carriedStep, resume } : null;
}

/** The carried idea goes first; the planner's own pick of it is dropped. */
function withCarriedStep(plan: LessonPlan, step: LessonStep): LessonPlan {
  const rest = plan.steps.filter((s) => s.nodeId !== step.nodeId).map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => d !== step.nodeId) }));
  const carried = { ...step, dependsOn: [] };
  if (plan.steps.length === 0) return { ...plan, title: `Continue: ${step.name}`, orientation: `Today picks up ${step.name} where you stopped.`, steps: [carried] };
  return { ...plan, steps: [carried, ...rest] };
}

/** Copy the carried idea's cards and answers into the new session so its history shows them. */
function carryEvents(db: Database, fromSessionId: string, toSessionId: string, nodeId: string): void {
  for (const event of listSessionEvents(db, fromSessionId)) {
    if ((event.kind === 'card' || event.kind === 'response') && event.payload.nodeId === nodeId) {
      appendSessionEvent(db, toSessionId, event.kind, { ...event.payload, carriedFrom: fromSessionId });
    }
  }
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

export function publicCard(card: TutorCard | null): PublicCard | null {
  if (!card) return null;
  switch (card.stage) {
    case 'predict':
    case 'connect':
    case 'compress':
      return { stage: card.stage, prompt: card.prompt };
    case 'explain':
    case 'support':
    case 'reteach':
      return { stage: card.stage, markdown: card.markdown };
    case 'check':
      return { stage: 'check', question: card.question };
    case 'derive':
      return { stage: 'derive', prompt: card.prompt };
    case 'use':
      return { stage: 'use', task: card.task };
    case 'index':
      return { stage: 'index', gist: card.gist, placement: card.placement, question: card.question };
  }
}

function snapshot(db: Database, session: SessionRecord<SessionState>, work: SessionWork | undefined): SessionSnapshot {
  const s = session.state;
  const step = s.phase === 'teach' ? s.plan.steps[s.stepIndex] : undefined;
  const stages = step ? stepStages(step) : [];
  const goal = s.goalId ? getGoal(db, s.goalId) : undefined;
  return {
    id: session.id,
    goalId: s.goalId,
    goalText: goal?.text ?? '',
    goalTitle: goal ? (goal.title ?? goal.text) : 'Free study',
    free: s.free ? { description: s.free.description, picked: s.free.picked, counted: s.free.counted } : null,
    owed: s.owed === true,
    startedAt: session.startedAt,
    status: session.status,
    phase: s.phase,
    plan: { title: s.plan.title, orientation: s.plan.orientation, steps: s.plan.steps.map((st) => ({ ...st, status: s.nodeStatus[st.nodeId] ?? 'pending' })) },
    current:
      step && s.stage
        ? {
            nodeId: step.nodeId,
            name: step.name,
            why: step.why,
            aim: step.aim,
            simplified: step.simplified,
            note: s.edge.wrapping ? 'This idea has had its half hour: one last step, then on to the next.' : null,
            canTestOut: canTestOut(step, s.stage, s.edge),
            stage: s.stage,
            stages,
            stageIndex: Math.max(0, stages.indexOf(s.supportAfter ?? s.stage)),
            stageCount: stages.length,
            position: s.plan.steps.findIndex((st) => st.nodeId === step.nodeId) + 1,
            planned: s.plan.steps.length,
            minutesUsed: Math.round(minutesOn(db, s, session.id, step.nodeId)),
            minutesAllowed: Math.round(ideaAllowance(step.minutes)),
            hintsLeft: s.card && HINT_STAGES.has(s.stage) ? Math.max(0, MAX_HINTS - hintsTaken(openAsides(db, session.id, step.nodeId, s.stage))) : 0,
          }
        : null,
    card: publicCard(s.card),
    asides: step && s.stage && s.card ? openAsides(db, session.id, step.nodeId, s.stage) : [],
    previousNodes: s.previousNodes,
    closing: s.closing,
    history: sessionHistory(db, session),
    frontier: step ? frontierMap(db, s, step.nodeId) : null,
    practice: s.practiceSetId ? practiceView(db, s.practiceSetId) : null,
    practiceRevealed: s.practiceRevealed ?? null,
    work: work?.forSession(session.id) ?? null,
  };
}

function asideOf(event: { id: string; payload: Record<string, unknown> }): Aside | null {
  const p = event.payload as { mode?: AsideMode; question?: string; answer?: string };
  return p.mode && typeof p.answer === 'string' ? { id: event.id, mode: p.mode, question: p.question ?? '', answer: p.answer } : null;
}

const hintsTaken = (asides: Aside[]) => asides.filter((a) => a.mode === 'hint').length;

/** What was asked about the card that is open now: the asides since that card was shown. */
function openAsides(db: Database, sessionId: string, nodeId: string, stage: Stage): Aside[] {
  let asides: Aside[] = [];
  for (const event of listSessionEvents(db, sessionId)) {
    const p = event.payload as { nodeId?: string; stage?: Stage };
    if (p.nodeId !== nodeId || p.stage !== stage) continue;
    if (event.kind === 'card') asides = [];
    else if (event.kind === 'aside') {
      const aside = asideOf(event);
      if (aside) asides.push(aside);
    }
  }
  return asides;
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
    const answer = await runTutorAside(deps.provider, { ...context, open: { stage, card, unanswered: isGraded(stage) }, mode: input.mode, question, hint });
    stillOpen(db, sessionId);
    appendSessionEvent(db, sessionId, 'aside', { nodeId: step.nodeId, stage, mode: input.mode, question, answer });
    // what the tutor said is taught material: it is read into the map with the rest, and the card writer sees it (a hint is not)
    if (input.mode !== 'hint') state.transcript.push({ nodeId: step.nodeId, nodeName: step.name, stage, text: answer });
    saveSessionState(db, sessionId, state);
  });
  return snapshot(db, normalized(getSession<SessionState>(db, sessionId) as SessionRecord<SessionState>), deps.work);
}

/** Rebuild the conversation from session events, so it survives restarts. The open card is not history. */
export function sessionHistory(db: Database, session: SessionRecord<SessionState>): SessionHistory {
  const s = session.state;
  const names = new Map(s.plan.steps.map((st) => [st.nodeId, st.name]));
  const items = new Map<string, HistoryItem[]>();
  let reconstruct: SessionHistory['reconstruct'] = null;
  const previousNames = new Map(s.previousNodes.map((n) => [n.id, n.name]));
  for (const event of listSessionEvents(db, session.id)) {
    const p = event.payload as { carriedFrom?: string; nodeId?: string; stage?: Stage; card?: TutorCard; response?: LearnerResponse; grade?: Grade; text?: string; recalled?: { nodeId: string; score: number; note: string }[]; attachments?: string[]; quote?: string };
    if (event.kind === 'reconstruct') {
      reconstruct = { text: p.text ?? '', recalled: (p.recalled ?? []).map((r) => ({ ...r, name: previousNames.get(r.nodeId) ?? r.nodeId })), attachments: p.attachments, quote: p.quote };
      continue;
    }
    if (!p.nodeId || !p.stage) continue;
    const list = items.get(p.nodeId) ?? [];
    items.set(p.nodeId, list);
    if (event.kind === 'card' && p.card) {
      const card = publicCard(p.card);
      if (card) list.push({ id: event.id, stage: p.stage, card, asides: [], response: null, grade: null, carried: Boolean(p.carriedFrom) });
    } else if (event.kind === 'aside') {
      const aside = asideOf(event);
      const open = [...list].reverse().find((h) => h.stage === p.stage && h.response === null);
      if (aside && open) open.asides.push(aside);
    } else if (event.kind === 'response' && p.response) {
      const open = [...list].reverse().find((h) => h.stage === p.stage && h.response === null);
      if (open) {
        open.response = p.response;
        open.grade = p.grade ?? null;
      }
    }
  }
  const order = [...s.plan.steps.map((st) => st.nodeId)].filter((id) => items.has(id));
  const nodes = order.map((nodeId) => {
    const answered = (items.get(nodeId) ?? []).filter((h) => h.response !== null);
    const graded = answered.map((h) => h.grade?.score).filter((x): x is number => typeof x === 'number');
    return {
      nodeId,
      name: names.get(nodeId) ?? nodeId,
      status: s.nodeStatus[nodeId] ?? 'pending',
      score: graded.length ? graded.reduce((a, b) => a + b, 0) / graded.length : null,
      items: answered,
    };
  });
  return { reconstruct, nodes: nodes.filter((n) => n.items.length > 0 || n.status === 'active') };
}

function frontierMap(db: Database, s: SessionState, centerId: string): FrontierMap {
  const view = loadKnowledge(db);
  const planIds = s.plan.steps.map((st) => st.nodeId).filter((id) => id !== centerId);
  const near = neighbourhood(centerId, view.index, FRONTIER_SIZE, planIds.slice(0, 4));
  const planned = new Set(s.plan.steps.filter((st) => s.nodeStatus[st.nodeId] !== 'done').map((st) => st.nodeId));
  const stateOf = (id: string): FrontierState => {
    if (id === centerId) return 'current';
    if (view.owned.has(id)) return 'owned';
    if (view.fringe.has(id) || planned.has(id)) return 'learnable';
    return 'beyond';
  };
  // with no goal, the edge is the whole map's
  const edgeCount = s.goalId ? candidatesForGoal(db, s.goalId, view).candidates.filter((c) => c.onFringe).length : view.fringe.size;
  return {
    nodes: near.nodeIds.filter((id) => view.nodes.has(id)).map((id) => ({ id, name: view.nodes.get(id)?.name ?? id, state: stateOf(id) })),
    edges: near.edges,
    edgeCount,
  };
}

export function sessionView(db: Database): KnowledgeView {
  return loadKnowledge(db);
}
