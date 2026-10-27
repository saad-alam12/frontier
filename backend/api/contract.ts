/**
 * The IPC contract between the renderer and the backend. The UI imports only types from here.
 * Each method has an input and an output type; handlers live in ./handlers.ts.
 */
import type { Effort, ModelOptions, Settings, SettingsPatch } from '../settings/schema';
import type { MaterialRole } from '../core/types';
import type { ConnectionTestResult } from '../agents/connectionTest';
import type { DeltaItem, DeltaSummary, IdeaRef, SourceSummary } from '../services/library';
import type { IngestProgress } from '../services/ingestion';
import type { GoalDetail, GoalForm, GoalWorkState, MaterialView } from '../services/goals';
import type { ProbeAnswerInput, ProbeOutcome, ProbeView } from '../services/probe';
import type { LessonPlan } from '../services/planner';
import type { FrontierMap, FrontierState, HistoryItem, HistoryNode, PublicCard, SessionHistory, SessionSnapshot } from '../services/session';
import type { Grade, LearnerResponse } from '../agents/tutor';

export type { DeltaItem, IdeaRef, Effort, ModelOptions, GoalForm, GoalWorkState, MaterialView };
export type { Assessment, ExamProfile, GoalKind, MaterialRole, UpcomingUnit } from '../core/types';
export type { SkillStatus } from '../core/goals';
export type { Settings, SettingsPatch, ConnectionTestResult, DeltaSummary, SourceSummary, IngestProgress, GoalDetail, ProbeAnswerInput, ProbeOutcome, ProbeView, LessonPlan };
export type { PublicCard, SessionSnapshot, Grade, LearnerResponse, FrontierMap, FrontierState, HistoryItem, HistoryNode, SessionHistory };
export type { Stage } from '../core/session';
export type { Role } from '../llm/provider';
export type { DeltaClass } from '../core/delta';
export type { Goal, Depth } from '../core/types';

/** A file offered as goal material, with the role guessed from its content. */
export interface MaterialCandidate {
  sourceId: string;
  title: string;
  role: MaterialRole;
  reason: string;
  existed: boolean;
}

export interface AppInfo {
  version: string;
  dataFolder: string;
  settingsFile: string;
}

export interface ApiMethods {
  'app.info': { input: undefined; output: AppInfo };
  'settings.get': { input: undefined; output: Settings };
  'settings.update': { input: SettingsPatch; output: Settings };
  /** Known models, their efforts and the default per role, for the Settings dropdowns. */
  'settings.modelOptions': { input: undefined; output: ModelOptions };
  'settings.testConnection': { input: undefined; output: ConnectionTestResult };
  'settings.chooseFolder': { input: undefined; output: string | null };
  'library.list': { input: undefined; output: SourceSummary[] };
  /** Opens a file picker, adds the chosen files and starts ingesting them. */
  'library.addFiles': { input: undefined; output: { added: SourceSummary[]; skipped: string[] } };
  'library.run': { input: { sourceId: string }; output: undefined };
  'library.remove': { input: { sourceId: string }; output: undefined };
  'library.delta': { input: { sourceId: string }; output: DeltaSummary };
  'goals.list': { input: undefined; output: GoalDetail[] };
  'goals.get': { input: { goalId: string }; output: GoalDetail };
  /** Creates the goal with its material; reading, profiling and compiling continue in the background. */
  'goals.create': { input: { form: GoalForm }; output: GoalDetail };
  /** Saves edits; the compile that follows is incremental and keeps progress. */
  'goals.update': { input: { goalId: string; form: Partial<GoalForm> & { status?: 'active' | 'paused' | 'done' } }; output: GoalDetail };
  'goals.remove': { input: { goalId: string }; output: undefined };
  /** Recompile now (incremental) even if no new material arrived. */
  'goals.compile': { input: { goalId: string }; output: GoalDetail };
  /** Learn an expected (unverified) idea anyway. */
  'goals.startUnverified': { input: { goalId: string; nodeId: string }; output: GoalDetail };
  /** Opens a file picker; adds the files to the library unread and guesses each one's role. */
  'materials.pick': { input: undefined; output: MaterialCandidate[] };
  /** The same for dropped files. */
  'materials.addPaths': { input: { paths: string[] }; output: MaterialCandidate[] };
  'probe.create': { input: { goalId: string }; output: ProbeView };
  /** The goal's unsubmitted probe, if any. */
  'probe.open': { input: { goalId: string }; output: ProbeView | null };
  'probe.submit': { input: { probeId: string; answers: ProbeAnswerInput[] }; output: ProbeOutcome[] };
  'plan.preview': { input: { goalId: string }; output: LessonPlan };
  'session.current': { input: undefined; output: SessionSnapshot | null };
  /** Plans and opens a session for the goal, or returns the active one. */
  'session.start': { input: { goalId: string }; output: SessionSnapshot };
  'session.respond': { input: { sessionId: string; response: LearnerResponse }; output: SessionSnapshot };
  /** Leave the session for now; it stays active and resumes at the same card. */
  'session.pause': { input: { sessionId: string }; output: undefined };
  /** End the session for good. */
  'session.end': { input: { sessionId: string }; output: undefined };
  /** Unsent answers by key; values are opaque JSON strings owned by the UI. */
  'drafts.get': { input: { keys: string[] }; output: Record<string, string> };
  'drafts.set': { input: { key: string; value: string }; output: undefined };
}

export type ApiName = keyof ApiMethods;
export type ApiInput<N extends ApiName> = ApiMethods[N]['input'];
export type ApiOutput<N extends ApiName> = ApiMethods[N]['output'];

/** Events pushed from the backend to the renderer. */
export interface ApiEvents {
  'app.toast': { kind: 'info' | 'error'; message: string };
  'library.progress': IngestProgress;
  'goals.changed': { goalId: string };
}
export type EventName = keyof ApiEvents;

export const IPC_CHANNEL = 'frontier:invoke';
export const EVENT_CHANNEL = 'frontier:event';

export interface FrontierBridge {
  invoke<N extends ApiName>(name: N, input: ApiInput<N>): Promise<ApiOutput<N>>;
  on<E extends EventName>(event: E, handler: (payload: ApiEvents[E]) => void): () => void;
  /** The file system path of a dropped file (Electron no longer exposes File.path). */
  pathForFile(file: File): string;
}
