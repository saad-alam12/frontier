/**
 * What the window sees of a session: the open card without answer keys or rubrics, the conversation
 * rebuilt from events, and the frontier around the idea being taught.
 */
import type { Grade, LearnerResponse, TutorCard } from '../agents/tutor';
import { neighbourhood } from '../core/graph';
import { HINT_STAGES, MAX_HINTS, ideaAllowance } from '../core/session';
import type { Stage } from '../core/session';
import type { Depth } from '../core/types';
import type { CodeStarter } from '../core/code';
import type { Database } from '../store/db';
import { getGoal } from '../store/goals';
import { listSessionEvents } from '../store/sessions';
import type { SessionRecord } from '../store/sessions';
import { loadKnowledge } from './knowledge';
import type { KnowledgeView } from './knowledge';
import { candidatesForGoal } from './planner';
import { practiceView } from './practice';
import type { PracticeView } from './practice';
import type { LessonStep } from './planner';
import type { SessionWork, SessionWorkView } from './sessionWork';
import type { Phase, NodeStatus, SessionState, FreeSession } from './sessionState';
import type { Aside } from './sessionAsides';
import { asideOf, hintsTaken, openAsides } from './sessionAsides';
import { stepStages, canTestOut, minutesOn } from './sessionSteps';
import { pulledInNote } from './sessionPullIn';

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
  /** The question the last session left, asked first in the recall. */
  opening: string | null;
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

export type PublicCard =
  | { stage: 'predict' | 'connect' | 'compress'; prompt: string }
  | { stage: 'explain' | 'support' | 'reteach'; markdown: string }
  | { stage: 'check'; question: string; code?: CodeStarter }
  | { stage: 'derive'; prompt: string; code?: CodeStarter }
  | { stage: 'use'; task: string; code?: CodeStarter }
  | { stage: 'index'; gist: string; placement: string; question: string };

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
      return { stage: 'check', question: card.question, ...(card.code ? { code: card.code } : {}) };
    case 'derive':
      return { stage: 'derive', prompt: card.prompt, ...(card.code ? { code: card.code } : {}) };
    case 'use':
      return { stage: 'use', task: card.task, ...(card.code ? { code: card.code } : {}) };
    case 'index':
      return { stage: 'index', gist: card.gist, placement: card.placement, question: card.question };
  }
}

export function snapshot(db: Database, session: SessionRecord<SessionState>, work: SessionWork | undefined): SessionSnapshot {
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
            note: s.edge.wrapping ? 'This idea has had its half hour: one last step, then on to the next.' : pulledInNote(s, step.nodeId),
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
    opening: s.opening ?? null,
    closing: s.closing,
    history: sessionHistory(db, session),
    frontier: step ? frontierMap(db, s, step.nodeId) : null,
    practice: s.practiceSetId ? practiceView(db, s.practiceSetId) : null,
    practiceRevealed: s.practiceRevealed ?? null,
    work: work?.forSession(session.id) ?? null,
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
