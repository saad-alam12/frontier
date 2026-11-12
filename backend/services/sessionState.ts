/**
 * A teaching session's state (design §4), as it is stored after every transition, and what a session
 * needs to run.
 */
import type { Grade, LearnerResponse, TutorCard } from '../agents/tutor';
import { IDEA_MAX_MINUTES, normalizeEdge } from '../core/session';
import type { EdgeState, Stage } from '../core/session';
import type { IdeaFinished } from '../core/cards';
import type { Depth, GoalLevel } from '../core/types';
import type { LlmProvider } from '../llm/provider';
import type { Database } from '../store/db';
import type { SessionRecord } from '../store/sessions';
import type { IngestionService } from './ingestion';
import type { PracticeDeps } from './practice';
import type { LessonPlan, LessonStep } from './planner';
import type { SessionWork } from './sessionWork';

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
  /** "I know this: test me" from the map or a goal page: each idea opens at the question that shows its aim. */
  testMe?: boolean;
  /** Prerequisites pulled in mid-session (design §4.1): the idea taught first, the idea it is for, and the stage to return to. */
  pulledIn?: { nodeId: string; for: string; stage: Stage; returned?: boolean }[];
  /** The question the last session left (its preview), asked first in this one's recall. */
  opening?: string | null;
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

/**
 * Sessions saved before R3 planned steps by mode (index, teach, derive) and counted easy answers; read
 * them as aims and strong answers so they resume where they were.
 */
export function normalized(session: SessionRecord<SessionState>): SessionRecord<SessionState> {
  type OldStep = LessonStep & { mode?: 'index' | 'teach' | 'derive' };
  const steps = session.state.plan.steps.map((st: OldStep) => {
    if (st.aim !== undefined) return st;
    const aim: Depth = st.mode === 'index' ? 1 : st.mode === 'derive' ? 3 : 2;
    return { ...st, aim, fromDepth: 0 as Depth, minutes: IDEA_MAX_MINUTES, simplified: null };
  });
  return { ...session, state: { ...session.state, plan: { ...session.state.plan, steps }, edge: normalizeEdge(session.state.edge) } };
}
