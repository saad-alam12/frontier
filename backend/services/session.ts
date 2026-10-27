/**
 * The teaching session (design §4): reconstruct → orient → teach each node with the step loop →
 * close → preview. State is persisted after every transition so the app can resume at the same card.
 */
import { runRecall, runTutorStep } from '../agents/tutor';
import type { Grade, LearnerResponse, TutorCard, TutorStepInput } from '../agents/tutor';
import { dependents, neighbourhood } from '../core/graph';
import { applyGrade, emptyEdge, evidenceKindFor, isGraded, nextStage, stagesFor } from '../core/session';
import type { EdgeState, Stage } from '../core/session';
import type { LlmProvider } from '../llm/provider';
import type { Database } from '../store/db';
import { nowIso } from '../store/db';
import { listBugsForNode, recordBug, touchBug } from '../store/bugs';
import { getState } from '../store/evidence';
import { getGoal } from '../store/goals';
import { activeSession, appendSessionEvent, createSession, endSession, getSession, listSessionEvents, listSessions, saveSessionState } from '../store/sessions';
import type { SessionRecord } from '../store/sessions';
import { chunksCoveringNode, getSource } from '../store/sources';
import { listExamplesForNode } from '../store/world';
import { recordEvidence, setOwnStatement } from './evidence';
import type { IngestionService } from './ingestion';
import { loadKnowledge } from './knowledge';
import type { KnowledgeView } from './knowledge';
import { candidatesForGoal, planSession } from './planner';
import type { LessonPlan, LessonStep } from './planner';

export type Phase = 'reconstruct' | 'orient' | 'teach' | 'close' | 'preview' | 'done';
export type NodeStatus = 'pending' | 'active' | 'done';

export interface NodeHistoryEntry {
  stage: Stage;
  card: TutorCard;
  response: LearnerResponse | null;
  grade: Grade | null;
}

export interface SessionState {
  goalId: string;
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
}

/** What the renderer sees. Answer keys and rubrics never leave the backend. */
export interface SessionSnapshot {
  id: string;
  goalId: string;
  goalText: string;
  /** The goal's short name for the breadcrumb (its sentence until compiled). */
  goalTitle: string;
  startedAt: string;
  status: SessionRecord['status'];
  phase: Phase;
  plan: { title: string; orientation: string; steps: (LessonStep & { status: NodeStatus })[] };
  current: { nodeId: string; name: string; why: string; mode: LessonStep['mode']; stage: Stage; stages: Stage[]; stageIndex: number; stageCount: number } | null;
  card: PublicCard | null;
  previousNodes: { id: string; name: string }[];
  closing: SessionState['closing'];
  /** Everything already said in this session, oldest first, rebuilt from session events. */
  history: SessionHistory;
  /** The ideas around the current one, for the side panel map. */
  frontier: FrontierMap | null;
}

/** One answered step: the card as shown, the learner's answer exactly as given, the rating. */
export interface HistoryItem {
  id: string;
  stage: Stage;
  card: PublicCard;
  response: LearnerResponse | null;
  grade: Grade | null;
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
  reconstruct: { text: string; recalled: { nodeId: string; name: string; score: number; note: string }[] } | null;
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

export type PublicCard =
  | { stage: 'predict' | 'connect' | 'compress'; prompt: string }
  | { stage: 'explain' | 'support' | 'reteach'; markdown: string }
  | { stage: 'check'; question: string }
  | { stage: 'derive'; prompt: string }
  | { stage: 'use'; task: string }
  | { stage: 'index'; gist: string; placement: string; question: string };

export interface SessionDeps {
  db: Database;
  provider: LlmProvider;
  /** When present, the tutor's prose is ingested as a source after the session. */
  ingestion?: IngestionService;
}

export function currentSession(db: Database): SessionSnapshot | null {
  const session = activeSession<SessionState>(db);
  return session ? snapshot(db, session) : null;
}

export async function startSession(deps: SessionDeps, goalId: string): Promise<SessionSnapshot> {
  const { db } = deps;
  const active = activeSession<SessionState>(db);
  if (active) return snapshot(db, active);
  const goal = getGoal(db, goalId);
  if (!goal) throw new Error(`unknown goal ${goalId}`);
  const plan = await planSession(db, deps.provider, goalId);
  if (plan.steps.length === 0) throw new Error(`Nothing to teach for this goal yet: ${plan.orientation}`);
  const previousNodes = previouslyTaughtNodes(db, goalId);
  const state: SessionState = {
    goalId,
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
  };
  const session = createSession(db, goalId, state);
  appendSessionEvent(db, session.id, 'start', { goalId, plan: { title: plan.title, steps: plan.steps.map((s) => s.nodeId) } });
  return snapshot(db, session);
}

/** Pause keeps the session active: reopening resumes at the same card with nothing regenerated. */
export function pauseSession(db: Database, sessionId: string): void {
  const session = getSession<SessionState>(db, sessionId);
  if (!session || session.status !== 'active') return;
  appendSessionEvent(db, sessionId, 'pause', {});
}

/** End a session early for good; what was learned so far stays as evidence. */
export function abandonSession(db: Database, sessionId: string): void {
  const session = getSession<SessionState>(db, sessionId);
  if (!session || session.status !== 'active') return;
  endSession(db, sessionId, 'abandoned');
  appendSessionEvent(db, sessionId, 'abandon', {});
}

/** Advance the session with the learner's response to the current card (or an acknowledgement). */
export async function respond(deps: SessionDeps, sessionId: string, response: LearnerResponse): Promise<SessionSnapshot> {
  const { db } = deps;
  const session = getSession<SessionState>(db, sessionId);
  if (!session) throw new Error(`unknown session ${sessionId}`);
  if (session.status !== 'active') return snapshot(db, session);
  const state = session.state;
  const goal = getGoal(db, state.goalId);
  const goalText = goal?.text ?? '';

  switch (state.phase) {
    case 'reconstruct': {
      const view = loadKnowledge(db);
      const nodes = state.previousNodes.map((n) => ({ id: n.id, name: n.name, statement: view.nodes.get(n.id)?.statement ?? '' })).filter((n) => view.nodes.has(n.id));
      if (nodes.length) {
        const recall = await runRecall(deps.provider, { goalText, nodes, text: response.answer, closing: false });
        for (const r of recall.recalled) {
          recordEvidence(db, { nodeId: r.nodeId, kind: 'recall', score: r.score, reasoning: r.note || 'free recall at session start', sessionId, context: { step: 'reconstruct' } });
        }
        appendSessionEvent(db, sessionId, 'reconstruct', { text: response.answer, recalled: recall.recalled });
      }
      state.phase = 'orient';
      break;
    }
    case 'orient': {
      appendSessionEvent(db, sessionId, 'orient', {});
      await beginStep(deps, sessionId, state, 0, goalText);
      break;
    }
    case 'teach': {
      await handleTeachResponse(deps, sessionId, state, response, goalText);
      break;
    }
    case 'close': {
      const view = loadKnowledge(db);
      const taught = state.plan.steps.filter((s) => state.nodeStatus[s.nodeId] === 'done');
      const nodes = taught.map((s) => ({ id: s.nodeId, name: s.name, statement: view.nodes.get(s.nodeId)?.statement ?? '' }));
      let closing: SessionState['closing'] = { canDo: 'Session complete.', previewQuestion: '', recall: [] };
      if (nodes.length) {
        const recall = await runRecall(deps.provider, { goalText, nodes, text: response.answer, closing: true });
        for (const r of recall.recalled) {
          recordEvidence(db, { nodeId: r.nodeId, kind: 'recall', score: r.score, reasoning: r.note || 'free recall at session close', sessionId, context: { step: 'close' } });
        }
        const names = new Map(nodes.map((n) => [n.id, n.name]));
        closing = { canDo: recall.canDo ?? '', previewQuestion: recall.previewQuestion ?? '', recall: recall.recalled.map((r) => ({ ...r, name: names.get(r.nodeId) ?? r.nodeId })) };
      }
      state.closing = closing;
      appendSessionEvent(db, sessionId, 'close', { text: response.answer, closing });
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
      await ingestTranscript(deps, sessionId, state);
      return snapshot(db, getSession<SessionState>(db, sessionId) as SessionRecord<SessionState>);
    }
    case 'done':
      break;
  }
  saveSessionState(db, sessionId, state);
  return snapshot(db, { ...session, state });
}

async function beginStep(deps: SessionDeps, sessionId: string, state: SessionState, index: number, goalText: string): Promise<void> {
  state.stepIndex = index;
  state.edge = emptyEdge();
  state.supportAfter = null;
  state.pendingEffort = null;
  const step = state.plan.steps[index];
  if (!step) {
    state.phase = 'close';
    state.stage = null;
    state.card = null;
    return;
  }
  state.phase = 'teach';
  state.nodeStatus[step.nodeId] = 'active';
  const first = stagesFor(step.mode)[0] as Stage;
  await produceCard(deps, sessionId, state, step, first, null, goalText);
}

/** Ask the tutor for the card of `stage` (grading `previous` in the same call when given) and show it. */
async function produceCard(
  deps: SessionDeps,
  sessionId: string,
  state: SessionState,
  step: LessonStep,
  stage: Stage,
  previous: TutorStepInput['previous'],
  goalText: string,
): Promise<Grade | null> {
  const result = await runTutorStep(deps.provider, buildTutorInput(deps.db, state, step, previous, stage, goalText));
  if (!result.card) throw new Error('the tutor returned no card');
  state.stage = stage;
  state.card = result.card;
  pushHistory(state, step.nodeId, { stage, card: result.card, response: null, grade: null });
  if (result.card.stage === 'explain' || result.card.stage === 'support' || result.card.stage === 'reteach') state.transcript.push({ nodeId: step.nodeId, nodeName: step.name, stage, text: result.card.markdown });
  if (result.card.stage === 'index') state.transcript.push({ nodeId: step.nodeId, nodeName: step.name, stage, text: `${result.card.gist}\n\n${result.card.placement}` });
  appendSessionEvent(deps.db, sessionId, 'card', { nodeId: step.nodeId, stage, card: result.card });
  return result.grade;
}

async function handleTeachResponse(deps: SessionDeps, sessionId: string, state: SessionState, response: LearnerResponse, goalText: string): Promise<void> {
  const { db } = deps;
  const step = state.plan.steps[state.stepIndex];
  const stage = state.stage;
  const card = state.card;
  if (!step || !stage || !card) throw new Error('no card to respond to');
  const stages = stagesFor(step.mode);

  if (!isGraded(stage)) {
    // explain / support / reteach: the learner read it; an effort rating may ride along to the next evidence
    if (response.effort !== undefined) state.pendingEffort = response.effort;
    finishHistory(state, step.nodeId, stage, response, null);
    appendSessionEvent(db, sessionId, 'response', { nodeId: step.nodeId, stage, response });
    const resumeFrom = stage === 'support' || stage === 'reteach' ? (state.supportAfter ?? stage) : stage;
    state.supportAfter = null;
    const next = nextStage(stages, resumeFrom, 'none');
    await advance(deps, sessionId, state, step, next, null, goalText);
    return;
  }

  const nominalNext = nextStage(stages, stage, 'none');
  const previous = { stage, card, response };
  let grade: Grade | null;
  if (nominalNext) {
    grade = await produceCard(deps, sessionId, state, step, nominalNext, previous, goalText);
  } else {
    const result = await runTutorStep(deps.provider, buildTutorInput(db, state, step, previous, null, goalText));
    grade = result.grade;
  }
  if (!grade) throw new Error('the tutor returned no grade');
  finishHistory(state, step.nodeId, stage, response, grade);
  appendSessionEvent(db, sessionId, 'response', { nodeId: step.nodeId, stage, response, grade });
  writeOutcome(db, sessionId, state, step, stage, response, grade);

  const { edge, action } = applyGrade(state.edge, grade.score);
  state.edge = edge;
  if (action === 'support' || action === 'escalate') {
    state.supportAfter = stage;
    await produceCard(deps, sessionId, state, step, action === 'support' ? 'support' : 'reteach', null, goalText);
    return;
  }
  const next = nextStage(stages, stage, action);
  if (next === nominalNext) {
    if (next === null) await advance(deps, sessionId, state, step, null, null, goalText);
    return; // the card for `next` is already showing
  }
  await advance(deps, sessionId, state, step, next, null, goalText);
}

/** Move to `next` within the node (producing its card) or finish the node and begin the next step. */
async function advance(deps: SessionDeps, sessionId: string, state: SessionState, step: LessonStep, next: Stage | null, previous: TutorStepInput['previous'], goalText: string): Promise<void> {
  if (next === null) {
    state.nodeStatus[step.nodeId] = 'done';
    appendSessionEvent(deps.db, sessionId, 'node-done', { nodeId: step.nodeId });
    await beginStep(deps, sessionId, state, state.stepIndex + 1, goalText);
    return;
  }
  await produceCard(deps, sessionId, state, step, next, previous, goalText);
}

function writeOutcome(db: Database, sessionId: string, state: SessionState, step: LessonStep, stage: Stage, response: LearnerResponse, grade: Grade): void {
  const kind = evidenceKindFor(stage);
  if (kind) {
    recordEvidence(db, {
      nodeId: step.nodeId,
      kind,
      score: grade.score,
      reasoning: grade.feedback,
      confidence: response.confidence ?? null,
      effort: state.pendingEffort ?? response.effort ?? null,
      sessionId,
      context: { step: stage },
    });
    state.pendingEffort = null;
  }
  if (stage === 'compress' && response.answer.trim()) setOwnStatement(db, step.nodeId, response.answer.trim(), response.handle?.trim() || null);
  if (stage === 'connect' && grade.score >= 0.7 && response.answer.trim()) {
    state.transcript.push({ nodeId: step.nodeId, nodeName: step.name, stage, text: `Link the learner stated and the tutor confirmed: ${response.answer.trim()}` });
  }
  if (grade.misconception) {
    const open = listBugsForNode(db, step.nodeId).find((b) => b.description.toLowerCase() === grade.misconception?.toLowerCase());
    if (open) touchBug(db, open.id);
    else recordBug(db, step.nodeId, grade.misconception);
  }
}

function buildTutorInput(db: Database, state: SessionState, step: LessonStep, previous: TutorStepInput['previous'], nextStage: Stage | null, goalText: string): TutorStepInput {
  const view = loadKnowledge(db);
  const node = view.nodes.get(step.nodeId);
  if (!node) throw new Error(`unknown node ${step.nodeId}`);
  const premiseIds = new Set<string>();
  for (const chain of view.index.into.get(node.id) ?? []) for (const p of chain.premises) premiseIds.add(p);
  const premises = [...premiseIds].map((id) => {
    const p = view.nodes.get(id);
    const s = getState(db, id);
    return { name: p?.name ?? id, statement: p?.statement ?? '', owned: view.owned.has(id), ownStatement: s?.ownStatement ?? null, handle: s?.handle ?? null };
  });
  const deps = [...dependents(node.id, view.index, 1, 1).keys()].map((id) => ({ name: view.nodes.get(id)?.name ?? id }));
  return {
    goalText,
    why: step.why,
    node: { id: node.id, kind: node.kind, name: node.name, statement: node.statement },
    premises,
    dependents: deps,
    bugs: listBugsForNode(db, node.id).map((b) => b.description),
    examples: listExamplesForNode(db, node.id).map((e) => ({ title: e.title, locator: `${getSource(db, e.sourceId)?.title ?? 'source'}, ${e.locator}`, body: e.body })),
    excerpts: chunksCoveringNode(db, node.id).map((c) => ({ locator: `${c.sourceTitle}, ${c.locator}`, text: c.text.slice(0, 1800) })),
    history: (state.history[node.id] ?? []).filter((h) => h.response !== null || h.grade !== null),
    previous,
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

function previouslyTaughtNodes(db: Database, goalId: string): { id: string; name: string }[] {
  const last = listSessions<SessionState>(db, 20).find((s) => s.goalId === goalId && s.status === 'done');
  if (!last) return [];
  return last.state.plan.steps.filter((s) => last.state.nodeStatus[s.nodeId] === 'done').map((s) => ({ id: s.nodeId, name: s.name }));
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

function snapshot(db: Database, session: SessionRecord<SessionState>): SessionSnapshot {
  const s = session.state;
  const step = s.phase === 'teach' ? s.plan.steps[s.stepIndex] : undefined;
  const stages = step ? stagesFor(step.mode) : [];
  return {
    id: session.id,
    goalId: s.goalId,
    goalText: getGoal(db, s.goalId)?.text ?? '',
    goalTitle: getGoal(db, s.goalId)?.title ?? getGoal(db, s.goalId)?.text ?? '',
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
            mode: step.mode,
            stage: s.stage,
            stages,
            stageIndex: Math.max(0, stages.indexOf(s.supportAfter ?? s.stage)),
            stageCount: stages.length,
          }
        : null,
    card: publicCard(s.card),
    previousNodes: s.previousNodes,
    closing: s.closing,
    history: sessionHistory(db, session),
    frontier: step ? frontierMap(db, s, step.nodeId) : null,
  };
}

/** Rebuild the conversation from session events, so it survives restarts. The open card is not history. */
export function sessionHistory(db: Database, session: SessionRecord<SessionState>): SessionHistory {
  const s = session.state;
  const names = new Map(s.plan.steps.map((st) => [st.nodeId, st.name]));
  const items = new Map<string, HistoryItem[]>();
  let reconstruct: SessionHistory['reconstruct'] = null;
  const previousNames = new Map(s.previousNodes.map((n) => [n.id, n.name]));
  for (const event of listSessionEvents(db, session.id)) {
    const p = event.payload as { nodeId?: string; stage?: Stage; card?: TutorCard; response?: LearnerResponse; grade?: Grade; text?: string; recalled?: { nodeId: string; score: number; note: string }[] };
    if (event.kind === 'reconstruct') {
      reconstruct = { text: p.text ?? '', recalled: (p.recalled ?? []).map((r) => ({ ...r, name: previousNames.get(r.nodeId) ?? r.nodeId })) };
      continue;
    }
    if (!p.nodeId || !p.stage) continue;
    const list = items.get(p.nodeId) ?? [];
    items.set(p.nodeId, list);
    if (event.kind === 'card' && p.card) {
      const card = publicCard(p.card);
      if (card) list.push({ id: event.id, stage: p.stage, card, response: null, grade: null });
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
  const { candidates } = candidatesForGoal(db, s.goalId, view);
  return {
    nodes: near.nodeIds.filter((id) => view.nodes.has(id)).map((id) => ({ id, name: view.nodes.get(id)?.name ?? id, state: stateOf(id) })),
    edges: near.edges,
    edgeCount: candidates.filter((c) => c.onFringe).length,
  };
}

export function sessionView(db: Database): KnowledgeView {
  return loadKnowledge(db);
}
