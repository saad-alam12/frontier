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
import type { FadingIdea, GoalSchedule, PracticeProblemView, PracticeView } from '../services/practice';
import type { TodayGoal, TodayView } from '../services/today';
import type { MapNodeView, MapState, MapView, NodeCard } from '../services/map';
import type { LookupAnswer, LookupHit } from '../services/lookup';
import type { Trail, TrailItem, TrailSummary } from '../services/trails';
import type { GoalProgress, PlanPreview, ResourceTime } from '../services/budget';
import type { RemapView } from '../services/remap';
import type { TickInput } from '../services/activity';
import type { StatsFilter, StatsRange, StatsView } from '../services/stats';
import type { EraseRequest, ErasePreview, EraseResult, EraseScope } from '../services/erase';
export type { EraseRequest, ErasePreview, EraseResult, EraseScope };
import type { GoalBudget } from '../core/types';
import type { ImageUpload } from '../core/attachments';
import type { CardInput, CardListFilter, CardListView, CardPreferences, CardQueueView, CardStats, CardSummary, CardView, DraftRequest, GoalCardSettings, ReviewCardView } from '../services/cards';
import type { CardText } from '../agents/cardWriter';
import type { CardOrigin, CardPhase, CardRating } from '../core/cards';

export type { CardInput, CardListFilter, CardListView, CardOrigin, CardPhase, CardPreferences, CardQueueView, CardRating, CardStats, CardSummary, CardText, CardView, DraftRequest, GoalCardSettings, ReviewCardView };

export type { GoalProgress, PlanPreview, RemapView, ResourceTime, TickInput, StatsFilter, StatsRange, StatsView };
export type { GoalPlan, Pace, PaceKind } from '../core/budget';

export type { MapNodeView, MapState, MapView, NodeCard, LookupAnswer, LookupHit, Trail, TrailItem, TrailSummary };

export type { FadingIdea, GoalSchedule, PracticeProblemView, PracticeView, TodayGoal, TodayView };

export type { DeltaItem, IdeaRef, Effort, ModelOptions, GoalForm, GoalWorkState, MaterialView };
export type { Assessment, Coverage, ExamProfile, GoalBudget, GoalFocus, GoalKind, GoalLevel, MaterialRole, UpcomingUnit } from '../core/types';
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
  /** Read a source again into lesson-sized ideas; returns how many of its old ideas were retired. */
  'library.reread': { input: { sourceId: string }; output: { retired: number } };
  'library.delta': { input: { sourceId: string }; output: DeltaSummary };
  'goals.list': { input: undefined; output: GoalDetail[] };
  'goals.get': { input: { goalId: string }; output: GoalDetail };
  /**
   * Creates the goal with its material; reading, profiling and compiling continue in the background.
   * A draft is compiled and previewed; it joins the plan when approved.
   */
  'goals.create': { input: { form: GoalForm; draft?: boolean }; output: GoalDetail };
  /** The plan a draft (or any goal) would get with this budget, without saving: for the live preview. */
  'goals.preview': { input: { goalId: string; budget: GoalBudget | null }; output: PlanPreview | null };
  /** Approve a draft's plan: it becomes active and its clock starts. */
  'goals.approve': { input: { goalId: string }; output: GoalDetail };
  /** Saves edits; the compile that follows is incremental and keeps progress. */
  'goals.update': { input: { goalId: string; form: Partial<GoalForm> & { status?: 'active' | 'paused' | 'done' } }; output: GoalDetail };
  'goals.remove': { input: { goalId: string }; output: undefined };
  /** Recompile now (incremental) even if no new material arrived. */
  'goals.compile': { input: { goalId: string }; output: GoalDetail };
  /** A re-map proposed for the goal, next to its current plan; null when none is ready. */
  'goals.remapView': { input: { goalId: string }; output: RemapView | null };
  /** Use the proposed map: it replaces the current one and its plan becomes the approved one. */
  'goals.remapApprove': { input: { goalId: string }; output: GoalDetail };
  /** Keep the current map; the gaps behind the proposal are not proposed again. */
  'goals.remapDismiss': { input: { goalId: string }; output: GoalDetail };
  /** Go deeper on simplified ideas (all of the goal's, or these): their minutes are added to the goal. Start a focus session on `nodeIds` next. */
  'goals.goDeeper': { input: { goalId: string; nodeIds?: string[] }; output: { minutes: number; nodeIds: string[] } };
  /** Ask for a new map for the goal's time (drawn in the background, then proposed). */
  'goals.remapRequest': { input: { goalId: string }; output: GoalDetail };
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
  /** Stop judging (Esc); the submit then fails with "cancelled" and the answers stay open. False when too late. */
  'probe.cancel': { input: { probeId: string }; output: boolean };
  'plan.preview': { input: { goalId: string }; output: LessonPlan };
  'session.current': { input: undefined; output: SessionSnapshot | null };
  /** Plans and opens a session for the goal, or returns the active one. */
  'session.start': { input: { goalId: string; focus?: string[] }; output: SessionSnapshot };
  'session.respond': { input: { sessionId: string; response: LearnerResponse }; output: SessionSnapshot };
  /** Stop the answer being judged (Esc); the respond then fails with "cancelled". False when too late. */
  'session.cancel': { input: { sessionId: string }; output: boolean };
  /** Leave the session for now; it stays active and resumes at the same card. */
  'session.pause': { input: { sessionId: string }; output: undefined };
  /** End the session for good. */
  'session.end': { input: { sessionId: string }; output: undefined };
  'today.view': { input: undefined; output: TodayView };
  /** The open practice set outside a session, if any. */
  'practice.current': { input: undefined; output: PracticeView | null };
  'practice.get': { input: { setId: string }; output: PracticeView };
  /** Generate a compound set over the goal's fading ideas, or a mock exam; null when nothing is due. */
  'practice.start': { input: { goalId: string; kind: 'compound' | 'mock' }; output: PracticeView | null };
  /** One attempt: stores the answer and returns the set with the solution revealed; the grade follows as an event. */
  'practice.submit': { input: { problemId: string; answer: string; confidence: number | null }; output: PracticeView };
  'map.view': { input: undefined; output: MapView };
  /** An idea's card without counting it as a lookup (the map's selection). */
  'map.card': { input: { nodeId: string }; output: NodeCard };
  /** What erasing would remove (ideas, links, ideas with evidence, sources), changing nothing: for the confirm dialog. */
  'map.erasePreview': { input: EraseRequest; output: ErasePreview };
  /** Erase from the map for good (Settings). Refused while a session is open or a chosen source is being read. */
  'map.erase': { input: EraseRequest; output: EraseResult };
  /** Ideas by meaning and name; a question also gets a short answer from the learner's own cards. */
  'lookup.search': { input: { query: string }; output: LookupAnswer };
  /** Open a card from Lookup: counts as a weak review (once per idea per day). */
  'lookup.open': { input: { nodeId: string }; output: NodeCard };
  'trails.list': { input: { nodeId?: string }; output: TrailSummary[] };
  'trails.get': { input: { sessionId: string }; output: Trail };
  /** Active time from the renderer, attributed to what the learner is doing. */
  'activity.tick': { input: TickInput; output: undefined };
  'stats.view': { input: StatsFilter; output: StatsView };
  /** Unsent answers by key; values are opaque JSON strings owned by the UI. */
  'drafts.get': { input: { keys: string[] }; output: Record<string, string> };
  'drafts.set': { input: { key: string; value: string }; output: undefined };
  /** Store an image for an answer (validated again here); returns the file name a response attaches. */
  'attachments.save': { input: ImageUpload; output: { name: string } };
  /** A stored answer image as a data URL, for thumbnails in history and Trails. */
  'attachments.read': { input: { name: string }; output: string };
  /** The flashcard review queue for every goal (null) or one: the card to show now and what is left. */
  'cards.queue': { input: { goalId: string | null }; output: CardQueueView };
  /** Rate a card on the Cards screen; returns the queue after it. */
  'cards.review': { input: { cardId: string; rating: CardRating; goalId: string | null }; output: CardQueueView };
  /** Every card, newest first, filtered by goal, idea and words (All cards, an idea's card on the map). */
  'cards.list': { input: CardListFilter; output: CardListView };
  /** Create a card the learner wrote or adjusted, or save an edit. */
  'cards.save': { input: CardInput; output: CardView };
  'cards.delete': { input: { cardId: string }; output: undefined };
  /** A suspended card stays but is never shown for review. */
  'cards.suspend': { input: { cardId: string; suspended: boolean }; output: CardView };
  /** A draft from the card writer, from a selection or a request; nothing is saved. */
  'cards.draft': { input: DraftRequest; output: CardText };
  /** Ideas to tag a card with, by name. */
  'cards.findIdeas': { input: { query: string }; output: IdeaRef[] };
  /** How many cards every goal (null) or one has, and how many Review would show now. */
  'cards.summary': { input: { goalId: string | null }; output: CardSummary };
  /** A goal's automatic cards: on or off, the maximum, and how many it has. */
  'cards.goalSettings': { input: { goalId: string }; output: GoalCardSettings & { auto: number } };
  'cards.saveGoalSettings': { input: { goalId: string; settings: GoalCardSettings }; output: GoalCardSettings & { auto: number } };
  /** Whether sessions without a goal make cards (Settings). */
  'cards.preferences': { input: undefined; output: CardPreferences };
  'cards.savePreferences': { input: CardPreferences; output: CardPreferences };
  'cards.stats': { input: Pick<StatsFilter, 'goalId' | 'range'>; output: CardStats };
}

export type ApiName = keyof ApiMethods;
export type ApiInput<N extends ApiName> = ApiMethods[N]['input'];
export type ApiOutput<N extends ApiName> = ApiMethods[N]['output'];

/** Events pushed from the backend to the renderer. */
export interface ApiEvents {
  'app.toast': { kind: 'info' | 'error'; message: string };
  'library.progress': IngestProgress;
  'goals.changed': { goalId: string };
  'practice.graded': { setId: string; problemId: string };
  /** Cards were added, changed or reviewed (automatic cards land in the background). */
  'cards.changed': { goalId: string | null };
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
