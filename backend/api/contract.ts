/**
 * The IPC contract between the renderer and the backend. The UI imports only types from here.
 * Each method has an input and an output type; handlers live in ./handlers.ts.
 */
import type { PracticeLevel } from '../core/scheduler';
import type { AsideMode } from '../agents/tutor';
import type { BackupInfo } from '../store/backup';
import type { Effort, ModelOptions, Settings, SettingsPatch } from '../settings/schema';
import type { MaterialRole } from '../core/types';
import type { ConnectionTestResult } from '../agents/connectionTest';
import type { DeltaItem, DeltaSummary, IdeaRef, LinkResult, PastedText, SourceSummary } from '../services/library';
import type { IngestProgress } from '../services/ingestion';
import type { GoalDetail, GoalForm, GoalWorkState, MaterialView } from '../services/goals';
import type { ProbeAnswerInput, ProbeOutcome, ProbeView } from '../services/probe';
import type { LessonPlan } from '../services/planner';
import type { FrontierMap, FrontierState, HistoryItem, HistoryNode, PublicCard, SessionHistory, SessionSnapshot, Aside } from '../services/session';
import type { SentAnswer, SessionWorkEvent, SessionWorkView } from '../services/sessionWork';
import type { FreeBackgroundView, FreeChoice, FreeIdeaView, FreePlanView } from '../services/freeSession';
import type { MakerRequest, MakerView } from '../services/sessionMaker';
import type { Grade, LearnerResponse } from '../agents/tutor';
import type { FadingIdea, GoalSchedule, PracticeProblemView, PracticeView } from '../services/practice';
import type { TodayGoal, TodayView } from '../services/today';
import type { MapNodeView, MapState, MapView, NodeCard } from '../services/map';
import type { LookupAnswer, LookupHit } from '../services/lookup';
import type { Trail, TrailItem, TrailSummary } from '../services/trails';
import type { GoalProgress, PlanPreview, ResourceTime } from '../services/budget';
import type { RemapView } from '../services/remap';
import type { AdditionView } from '../services/addition';
import type { TickInput } from '../services/activity';
import type { StatsFilter, StatsRange, StatsView } from '../services/stats';
import type { EraseRequest, ErasePreview, EraseResult, EraseScope } from '../services/erase';
export type { EraseRequest, ErasePreview, EraseResult, EraseScope, Aside, AsideMode };
import type { GoalBudget } from '../core/types';
import type { CodeAnswer } from '../core/code';
import type { InstallOutcome, PythonInfo, RunOutcome } from '../services/codeRunner';
import type { UsageView } from '../services/usage';
import type { DialogueView } from '../services/dialogue';
import type { CheatSheetView, GoalNotesView } from '../services/notes';
import type { DialogueKind } from '../store/dialogues';
import type { ImageUpload } from '../core/attachments';
import type { CardInput, CardListFilter, CardListView, CardPreferences, CardQueueView, CardStats, CardSummary, CardView, DraftRequest, GoalCardSettings, ReviewCardView } from '../services/cards';
import type { CardText } from '../agents/cardWriter';
import type { CardOrigin, CardPhase, CardRating } from '../core/cards';

export type { CardInput, CardListFilter, CardListView, CardOrigin, CardPhase, CardPreferences, CardQueueView, CardRating, CardStats, CardSummary, CardText, CardView, DraftRequest, GoalCardSettings, ReviewCardView };

export type { AdditionView, GoalProgress, PlanPreview, RemapView, ResourceTime, TickInput, StatsFilter, StatsRange, StatsView };
export type { GoalPlan, Pace, PaceKind } from '../core/budget';

export type { MapNodeView, MapState, MapView, NodeCard, LookupAnswer, LookupHit, Trail, TrailItem, TrailSummary };

export type { FadingIdea, GoalSchedule, PracticeProblemView, PracticeView, TodayGoal, TodayView };

export type { DeltaItem, IdeaRef, Effort, ModelOptions, GoalForm, GoalWorkState, MaterialView };
export type { Assessment, Coverage, ExamProfile, GoalBudget, GoalFocus, GoalKind, GoalLevel, MaterialRole, UpcomingUnit } from '../core/types';
export type { SkillStatus } from '../core/goals';
export type { Settings, SettingsPatch, ConnectionTestResult, DeltaSummary, LinkResult, SourceSummary, IngestProgress, GoalDetail, ProbeAnswerInput, ProbeOutcome, ProbeView, LessonPlan };
export type { PublicCard, SessionSnapshot, Grade, LearnerResponse, FrontierMap, FrontierState, HistoryItem, HistoryNode, SessionHistory };
export type { SentAnswer, SessionWorkEvent, SessionWorkView };
export type { FreeBackgroundView, FreeChoice, FreeIdeaView, FreePlanView, MakerRequest, MakerView };
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

export type { BackupInfo, PracticeLevel };

/** A picture of a page the tutor shows (design §4.2, "Figures"). */
export interface FigureView {
  dataUrl: string;
  /** The source and page, as the learner reads it. */
  where: string;
  width: number | null;
  height: number | null;
}

export type { CodeAnswer, CodeRun, CodeStarter } from '../core/code';
export type { InstallOutcome, PythonInfo, RunOutcome, UsageView };
export type { Preset } from '../settings/schema';
export type { ExamReport } from '../core/exam';
export type { DialogueKind, DialogueView };
export type { CheatSheetView, GoalNotesView, NoteIdeaView } from '../services/notes';

export interface AppInfo {
  version: string;
  dataFolder: string;
  settingsFile: string;
}

export interface ApiMethods {
  'app.info': { input: undefined; output: AppInfo };
  /** Show the log file (errors of calls and background work) in the file manager. */
  'app.showLog': { input: undefined; output: null };
  /** Copies of the data: one a day, one before each upgrade and each restore, and those the learner asked for. */
  'backups.list': { input: undefined; output: BackupInfo[] };
  'backups.create': { input: undefined; output: BackupInfo[] };
  /** Put a backup in place of the data (the data as it is now is copied first). The window reloads afterwards. */
  'backups.restore': { input: { file: string }; output: null };
  'backups.showFolder': { input: undefined; output: null };
  'settings.get': { input: undefined; output: Settings };
  'settings.update': { input: SettingsPatch; output: Settings };
  /** Known models, their efforts and the default per role, for the Settings dropdowns. */
  'settings.modelOptions': { input: undefined; output: ModelOptions };
  'settings.testConnection': { input: undefined; output: ConnectionTestResult };
  'settings.chooseFolder': { input: undefined; output: string | null };
  'library.list': { input: undefined; output: SourceSummary[] };
  /** Opens a file picker, adds the chosen files and starts ingesting them. */
  'library.addFiles': { input: undefined; output: { added: SourceSummary[]; skipped: string[] } };
  /** Files dropped on the window: added and read like files chosen in the dialog. */
  'library.addPaths': { input: { paths: string[] }; output: { added: SourceSummary[]; skipped: string[] } };
  /** Stop reading a source; what was read stays and the rest waits for "Run again". */
  'library.stop': { input: { sourceId: string }; output: undefined };
  /** Open the stored copy of a source in its usual app. */
  'library.openOriginal': { input: { sourceId: string }; output: null };
  /** Add pasted text (notes, an article, a transcript) as a source and start reading it. */
  'library.addText': { input: PastedText; output: { sourceId: string; existed: boolean } };
  /** Add what a web address points at; a video comes back as "paste its transcript". */
  'library.addLink': { input: { url: string }; output: LinkResult };
  'library.run': { input: { sourceId: string }; output: undefined };
  'library.remove': { input: { sourceId: string }; output: undefined };
  /** Read a source again into lesson-sized ideas; returns how many of its old ideas were retired. */
  'library.reread': { input: { sourceId: string }; output: { retired: number } };
  'library.delta': { input: { sourceId: string }; output: DeltaSummary };
  'goals.list': { input: undefined; output: GoalDetail[] };
  'goals.get': { input: { goalId: string }; output: GoalDetail };
  /** Save the goal as Markdown notes where the learner chooses; null when they cancel. */
  'goals.exportNotes': { input: { goalId: string }; output: { path: string | null } };
  /** A goal's notes: per skill, each idea with own words, handle, free note, worked examples and flashcards. */
  'notes.goal': { input: { goalId: string }; output: GoalNotesView };
  /** The goal on one page before an exam; `all` keeps every idea. */
  'notes.sheet': { input: { goalId: string; all?: boolean }; output: CheatSheetView };
  /** The learner's free note on an idea. */
  'notes.idea': { input: { nodeId: string }; output: { note: string | null } };
  /** Save the learner's free note on an idea; empty removes it. */
  'notes.saveIdea': { input: { nodeId: string; text: string }; output: { nodeId: string; note: string | null } };
  /** Print what the window shows (the notes or the sheet) with the system's print dialog. */
  'notes.print': { input: undefined; output: { printed: boolean } };
  /** Save what the window shows as a PDF where the learner chooses; null when they cancel. */
  'notes.savePdf': { input: { goalId: string; kind: 'notes' | 'sheet' }; output: { path: string | null } };
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
  /** Approve the plan again for the same time, so ideas left out or kept shallow come back where time was freed. */
  'goals.useFreedTime': { input: { goalId: string }; output: GoalDetail };
  /** Pause, finish or take up a goal again; everything it holds is kept. */
  'goals.setStatus': { input: { goalId: string; status: 'active' | 'paused' | 'done' }; output: GoalDetail };
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
  /** Add to the goal in the learner's words: worked out in the background, then previewed. */
  'goals.additionRequest': { input: { goalId: string; request: string }; output: GoalDetail };
  /** What the addition brings and what it does to the plan; null until it is worked out. */
  'goals.additionView': { input: { goalId: string }; output: AdditionView | null };
  /** Add it: the new skills join the goal; existing skills and approved depths stay. */
  'goals.additionApprove': { input: { goalId: string }; output: GoalDetail };
  /** Do not add it (also cancels one being worked out, or a failed one). */
  'goals.additionDismiss': { input: { goalId: string }; output: GoalDetail };
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
  /** Planning or judging that is running (or failed) in the background, also while no session is open yet. */
  'session.work': { input: undefined; output: SessionWorkView | null };
  /** Plans and opens a session for the goal, or returns the active one. Planning goes on if the screen closes. */
  /** `minutes`: fit the session to the time the learner has (Today, "I have 30 minutes"). */
  'session.start': { input: { goalId: string; focus?: string[]; minutes?: number }; output: SessionSnapshot };
  /** `draftKey`: the unsent answer's draft, deleted once the answer is accepted. */
  'session.respond': { input: { sessionId: string; response: LearnerResponse; draftKey?: string }; output: SessionSnapshot };
  /** Ask the tutor about the open card: a question of the learner's own, or the explanation in another form. Not graded. */
  'session.ask': { input: { sessionId: string; mode: AsideMode; question?: string }; output: SessionSnapshot };
  /** A session the learner chooses, as it would be (ideas, aims, missing background, minutes), changing nothing. */
  'session.freePreview': { input: FreeChoice; output: FreePlanView };
  /** Ask the session maker to turn a description into a session; it runs in the background (see `session.maker`). */
  'session.make': { input: MakerRequest; output: MakerView };
  /** The description being made into a session, or the proposal it became; null when there is none. */
  'session.maker': { input: undefined; output: MakerView | null };
  /** Open a session the learner chose: new ideas join the map, and the session starts at its plan. */
  'session.startFree': { input: FreeChoice; output: SessionSnapshot };
  /** Stop the answer being judged (Esc); the respond then fails with "cancelled". False when too late. */
  'session.cancel': { input: { sessionId: string }; output: boolean };
  /** Forget a session start that failed, once its error has been shown. */
  'session.dismissStart': { input: undefined; output: undefined };
  /** Leave the session for now; it stays active and resumes at the same card. */
  'session.pause': { input: { sessionId: string }; output: undefined };
  /** End the session for good. */
  'session.end': { input: { sessionId: string }; output: undefined };
  'today.view': { input: undefined; output: TodayView };
  /** The open practice set outside a session, if any. */
  'practice.current': { input: undefined; output: PracticeView | null };
  'practice.get': { input: { setId: string }; output: PracticeView };
  /** Generate a compound set over the goal's fading ideas, or a mock exam; null when nothing is due. */
  /** A set over what is fading, a mock exam, or (with `nodeIds`) practice the learner asked for on those ideas at a level. */
  /** `problems`: at most this many (the time the learner has on Today). */
  'practice.start': { input: { goalId: string; kind: 'compound' | 'mock'; nodeIds?: string[]; level?: PracticeLevel; problems?: number }; output: PracticeView | null };
  /** One attempt: stores the answer and returns the set with the solution revealed; the grade follows as an event. */
  'practice.submit': { input: { problemId: string; answer: string; confidence: number | null; code?: CodeAnswer }; output: PracticeView };
  /** An oral exam or a teach-back on a goal's learned ideas: it opens with the first question. */
  'dialogue.start': { input: { goalId: string; kind: DialogueKind }; output: DialogueView };
  'dialogue.get': { input: { dialogueId: string }; output: DialogueView };
  /** The goal's conversation left open half-way, to continue. */
  'dialogue.open': { input: { goalId: string }; output: DialogueView | null };
  'dialogue.answer': { input: { dialogueId: string; answer: string }; output: DialogueView };
  /** End it now: the verdict on what was said so far. */
  'dialogue.end': { input: { dialogueId: string }; output: DialogueView };
  /** Hand in a mock exam: its solutions, grades and report show; unanswered problems count zero in its score. */
  'practice.handIn': { input: { setId: string }; output: PracticeView };
  /** Leave a set as it stands: answered problems count, the rest write nothing. */
  'practice.end': { input: { setId: string }; output: null };
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
  /** Run the learner's Python (design §4.4, "Code"); `key` lets code.stop end it. A well-known missing library is installed first. */
  'code.run': { input: { source: string; key: string }; output: RunOutcome };
  'code.stop': { input: { key: string }; output: { stopped: boolean } };
  /** Install a library the code needs, after the learner pressed Install. */
  'code.install': { input: { package: string; key: string }; output: InstallOutcome };
  /** The Python Frontier uses, for Settings; `lookAgain` forgets the one found. */
  'code.python': { input: { lookAgain?: boolean }; output: PythonInfo };
  /** On a Mac with no Python: open Apple's installer for its command line tools, which include Python 3. */
  'code.installPython': { input: undefined; output: { message: string } };
  /** Model calls today and in the last seven days, for Settings. */
  'settings.usage': { input: undefined; output: UsageView };
  /** A figure the tutor showed: its picture as a data URL, and where it is from. */
  'figures.read': { input: { figureId: string }; output: FigureView };
  /** The flashcard review queue for every goal (null) or one: the card to show now and what is left. */
  'cards.queue': { input: { goalId: string | null }; output: CardQueueView };
  /** Rate a card on the Cards screen; returns the queue after it. */
  'cards.review': { input: { cardId: string; rating: CardRating; goalId: string | null }; output: CardQueueView };
  /** Take back the rating just given to this card; it is shown again. */
  'cards.undoReview': { input: { cardId: string; goalId: string | null }; output: CardQueueView };
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
  /** Session work started, finished, failed or was stopped. */
  'session.work': SessionWorkEvent;
  /** The session maker started, finished or failed. */
  'session.maker': { maker: MakerView | null };
  /** Cards were added, changed or reviewed (automatic cards land in the background). */
  'cards.changed': { goalId: string | null };
  /** The examiner's next turn of an oral exam or a teach-back, as it is written. */
  'dialogue.writing': { dialogueId: string; text: string };
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
