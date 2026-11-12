import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { EventSink } from './api/handlers';
import { TransformersEmbedder } from './ingest/embedder';
import type { Embedder } from './ingest/embedder';
import type { PageRenderer } from './ingest/pictures';
import { createInnerProvider, createProvider } from './llm';
import type { LlmProvider } from './llm/provider';
import type { ThrottledProvider } from './llm/queue';
import type { IdeaFinished } from './core/cards';
import { LogFile } from './log';
import { IngestionService } from './services/ingestion';
import { queueIdeaCards } from './services/cards';
import type { CardWriterDeps } from './services/cards';
import { GoalWorker, nextGoalStep } from './services/goalWorker';
import { upgradeDerivedStates, upgradeTimeOwners } from './services/knowledge';
import { SessionWork } from './services/sessionWork';
import { SessionMaker } from './services/sessionMaker';
import { CodeRunner } from './services/codeRunner';
import { FolderWatcher } from './services/folderWatch';
import { guessRole, updateGoalFromForm } from './services/goals';
import { listGoals, listMaterials } from './store/goals';
import type { Settings } from './settings/schema';
import { SettingsStore, dataPaths } from './settings/store';
import { dailyBackup, isBackupName, listBackups, manualBackup, restoreBackup as saveBeforeRestore } from './store/backup';
import type { BackupInfo } from './store/backup';
import { openDatabase } from './store/db';
import { releaseInterruptedSources } from './store/sources';
import { recordModelCall } from './store/modelCalls';
import type { Database } from './store/db';

/** Everything the IPC handlers need. Built once in main.ts; pieces are rebuilt when settings change. */
export class AppContext {
  readonly settings: SettingsStore;
  /** Errors of calls and of background work, kept beside the settings file. */
  readonly log: LogFile;
  /** Planning and judging in flight; it outlives the Session screen and survives a settings change. */
  readonly sessionWork = new SessionWork();
  /** "Describe it": the session maker's call and the proposal it leaves. */
  readonly sessionMaker = new SessionMaker();
  /** Where events for the window go; set once the window exists. */
  sink: EventSink = () => {};
  /** Told when settings changed, for what lives outside this context (the number on the app's icon). */
  afterSettings: () => void = () => {};
  /** The app's window, for printing what it shows; the app sets it. */
  window: () => Electron.BrowserWindow | null = () => null;
  private cachedProvider: ThrottledProvider | null = null;
  private cachedDb: Database | null = null;
  /** Databases of data folders the learner switched away from: closed at quit, never under work that still writes to them. */
  private readonly retiredDbs: Database[] = [];
  private cachedEmbedder: Embedder | null = null;
  private cachedIngestion: IngestionService | null = null;
  private cachedGoalWorker: GoalWorker | null = null;
  private cachedCodeRunner: CodeRunner | null = null;
  private cachedFolderWatcher: FolderWatcher | null = null;

  constructor(
    readonly version: string,
    readonly settingsFile: string,
    defaultDataFolder: string,
    /** Makes pictures of PDF pages that are mostly figures; the app passes the browser engine's. */
    private readonly renderer?: PageRenderer,
  ) {
    this.settings = new SettingsStore(settingsFile, defaultDataFolder);
    this.log = new LogFile(join(dirname(settingsFile), 'frontier.log'));
    this.ensureFolders();
    this.sessionWork.subscribe((event) => this.emit('session.work', event));
    this.sessionMaker.subscribe((maker) => this.emit('session.maker', { maker }));
  }

  paths() {
    return dataPaths(this.settings.get().dataFolder);
  }

  /** Send an event to the window. What the learner is told went wrong is also written to the log. */
  readonly emit: EventSink = (event, payload) => {
    const said = payload as { kind?: string; message?: string; sourceId?: string };
    if (event === 'app.toast' && said.kind === 'error') this.log.error('notice', said.message ?? '');
    if (event === 'library.progress' && said.message) this.log.error(`source ${said.sourceId ?? ''}`, said.message);
    this.sink(event, payload);
  };

  provider(): LlmProvider {
    if (!this.cachedProvider) {
      this.cachedProvider = createProvider(
        this.settings.get(),
        this.paths().agentCwd,
        (role, error) => this.log.error(`model call: ${role}`, error),
        // every call that answered is counted, for the usage line in Settings
        (role, result) =>
          recordModelCall(this.db(), {
            role,
            model: result.model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            cacheReadTokens: result.usage.cacheReadTokens ?? 0,
            cacheWriteTokens: result.usage.cacheWriteTokens ?? 0,
            costUsd: result.usage.costUsd ?? null,
          }),
      );
    }
    return this.cachedProvider;
  }

  db(): Database {
    if (!this.cachedDb) {
      this.cachedDb = openDatabase(this.paths().db, { backupsDir: this.paths().backups });
      upgradeTimeOwners(this.cachedDb);
      upgradeDerivedStates(this.cachedDb);
      // nothing is reading yet when a database opens, so a source still marked as being read was cut off by a quit
      releaseInterruptedSources(this.cachedDb);
    }
    return this.cachedDb;
  }

  embedder(): Embedder {
    if (!this.cachedEmbedder) this.cachedEmbedder = new TransformersEmbedder(this.paths().modelsCache);
    return this.cachedEmbedder;
  }

  ingestion(): IngestionService {
    if (!this.cachedIngestion) {
      this.cachedIngestion = new IngestionService({
        db: this.db(),
        provider: this.provider(),
        embedder: this.embedder(),
        sourcesDir: this.paths().sources,
        renderer: this.renderer,
        figuresDir: this.paths().figures,
        concurrency: this.settings.get().concurrency,
        onProgress: (p) => this.emit('library.progress', p),
        onSourceDone: (sourceId) => this.goalWorker().onSourceDone(sourceId),
      });
    }
    return this.cachedIngestion;
  }

  goalWorker(): GoalWorker {
    if (!this.cachedGoalWorker) {
      this.cachedGoalWorker = new GoalWorker({
        db: () => this.db(),
        provider: () => this.provider(),
        ingestion: () => this.ingestion(),
        embedder: () => this.embedder(),
        onChange: (goalId) => this.emit('goals.changed', { goalId }),
      });
    }
    return this.cachedGoalWorker;
  }

  /** Runs the learner's code with the Python on this computer, only when they press Run. */
  codeRunner(): CodeRunner {
    this.cachedCodeRunner ??= new CodeRunner({ envDir: this.paths().python, attachmentsDir: this.paths().attachments, pythonPath: () => this.settings.get().pythonPath });
    return this.cachedCodeRunner;
  }

  /**
   * Watched folders: a file of a goal's folder becomes that goal's material (its role guessed, read as
   * the goal needs it); a file of a folder with no goal goes to the Library and is read.
   */
  folderWatcher(): FolderWatcher {
    this.cachedFolderWatcher ??= new FolderWatcher({
      db: () => this.db(),
      addFile: async (path, goalId) => {
        const added = await this.ingestion().addFile(path);
        const { source } = added;
        if (goalId) {
          const materials = listMaterials(this.db(), goalId);
          if (!materials.some((m) => m.sourceId === source.id)) {
            const guess = await guessRole(this.db(), this.provider(), source.id).catch(() => ({ role: 'teaching' as const }));
            updateGoalFromForm(this.db(), goalId, { materials: [...materials.map((m) => ({ sourceId: m.sourceId, role: m.role })), { sourceId: source.id, role: guess.role }] });
            this.goalWorker().refresh(goalId);
            this.emit('goals.changed', { goalId });
          }
        } else if (source.status !== 'done') this.ingestion().start(source.id);
        return added;
      },
      onAdded: (folder, titles) =>
        this.emit('app.toast', { kind: 'info', message: titles.length === 1 ? `${titles[0]} arrived in ${basename(folder)} and was added.` : `${titles.length} new files arrived in ${basename(folder)} and were added.` }),
    });
    return this.cachedFolderWatcher;
  }

  /** What sessions and practice need to run and grade; grades are announced to the renderer. */
  practiceDeps() {
    return {
      db: this.db(),
      provider: this.provider(),
      ingestion: this.ingestion(),
      attachmentsDir: this.paths().attachments,
      figuresDir: this.paths().figures,
      work: this.sessionWork,
      onGraded: (event: { setId: string; problemId: string }) => this.emit('practice.graded', event),
      onError: (message: string) => this.emit('app.toast', { kind: 'error', message }),
      onIdeaFinished: (event: IdeaFinished) => queueIdeaCards(this.cardDeps(), event),
    };
  }

  /** What the card writer needs for automatic cards; new cards are announced to the renderer. */
  cardDeps(): CardWriterDeps {
    return {
      db: this.db(),
      provider: this.provider(),
      onChange: (event) => this.emit('cards.changed', event),
      onError: (message) => this.emit('app.toast', { kind: 'error', message }),
    };
  }

  /** Today's copy of the data, if there is none yet. A copy that cannot be written never stops the app. */
  backupIfDue(): void {
    try {
      dailyBackup(this.db(), this.paths().backups);
    } catch (error) {
      this.emit('app.toast', { kind: 'error', message: `Today's backup could not be written. ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  backups(): BackupInfo[] {
    return listBackups(this.paths().backups);
  }

  backupNow(): BackupInfo[] {
    manualBackup(this.db(), this.paths().backups);
    return this.backups();
  }

  /**
   * Put a backup in place of the data. The data as it is now is copied first, so a restore can be
   * undone. Refused while anything is being written (an answer judged, a source read): that work
   * holds the database open and would write into the restored data.
   */
  restoreBackup(file: string): void {
    const paths = this.paths();
    if (!isBackupName(file) || !existsSync(join(paths.backups, file))) throw new Error('That backup is no longer there.');
    if (this.sessionWork.current()?.status === 'running' || this.cachedIngestion?.isBusy() || this.cachedGoalWorker?.isBusy()) {
      throw new Error('Frontier is still working on something (an answer, a source or a goal). Wait until it has finished, then restore.');
    }
    const db = this.db();
    saveBeforeRestore(db, paths.backups);
    db.close();
    this.cachedDb = null;
    this.cachedIngestion = null;
    this.cachedGoalWorker = null;
    // the write-ahead files belong to the data being replaced
    for (const leftover of [`${paths.db}-wal`, `${paths.db}-shm`]) rmSync(leftover, { force: true });
    copyFileSync(join(paths.backups, file), paths.db);
    this.db();
    this.cachedFolderWatcher?.start();
  }

  resumeGoalWork(): void {
    for (const goal of listGoals(this.db())) if (nextGoalStep(this.db(), goal.id) !== null) this.goalWorker().refresh(goal.id);
  }

  /**
   * Settings changed. Later model calls use the new provider, models and limit; work in flight (a
   * source being read, an answer being judged) keeps running untouched. Only another data folder
   * means another database, and even then the old one stays open until quit, because work in flight
   * may still write to it.
   */
  onSettingsChanged(previous: Settings): void {
    const next = this.settings.get();
    this.afterSettings();
    this.cachedProvider?.reconfigure(createInnerProvider(next, this.paths().agentCwd), next.concurrency);
    this.cachedIngestion?.setConcurrency(next.concurrency);
    if (next.pythonPath !== previous.pythonPath) this.cachedCodeRunner?.lookAgain();
    if (next.dataFolder === previous.dataFolder) return;
    if (this.cachedDb) this.retiredDbs.push(this.cachedDb);
    this.cachedDb = null;
    this.cachedEmbedder = null;
    this.cachedIngestion = null;
    this.cachedGoalWorker = null;
    this.cachedCodeRunner = null;
    this.ensureFolders();
    // the other data folder has folders of its own to watch
    this.cachedFolderWatcher?.start();
  }

  close(): void {
    this.cachedFolderWatcher?.stop();
    for (const db of [this.cachedDb, ...this.retiredDbs]) db?.close();
    this.cachedDb = null;
    this.retiredDbs.length = 0;
  }

  private ensureFolders(): void {
    const p = this.paths();
    for (const dir of [p.root, p.sources, p.exports, p.modelsCache, p.agentCwd, p.attachments, p.figures, p.backups]) mkdirSync(dir, { recursive: true });
  }
}
