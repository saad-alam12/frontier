import { mkdirSync } from 'node:fs';
import type { EventSink } from './api/handlers';
import { TransformersEmbedder } from './ingest/embedder';
import type { Embedder } from './ingest/embedder';
import { createInnerProvider, createProvider } from './llm';
import type { LlmProvider } from './llm/provider';
import type { ThrottledProvider } from './llm/queue';
import type { IdeaFinished } from './core/cards';
import { IngestionService } from './services/ingestion';
import { queueIdeaCards } from './services/cards';
import type { CardWriterDeps } from './services/cards';
import { GoalWorker, nextGoalStep } from './services/goalWorker';
import { upgradeDerivedStates, upgradeTimeOwners } from './services/knowledge';
import { SessionWork } from './services/sessionWork';
import { SessionMaker } from './services/sessionMaker';
import { listGoals } from './store/goals';
import type { Settings } from './settings/schema';
import { SettingsStore, dataPaths } from './settings/store';
import { openDatabase } from './store/db';
import { releaseInterruptedSources } from './store/sources';
import type { Database } from './store/db';

/** Everything the IPC handlers need. Built once in main.ts; pieces are rebuilt when settings change. */
export class AppContext {
  readonly settings: SettingsStore;
  /** Planning and judging in flight; it outlives the Session screen and survives a settings change. */
  readonly sessionWork = new SessionWork();
  /** "Describe it": the session maker's call and the proposal it leaves. */
  readonly sessionMaker = new SessionMaker();
  emit: EventSink = () => {};
  private cachedProvider: ThrottledProvider | null = null;
  private cachedDb: Database | null = null;
  /** Databases of data folders the learner switched away from: closed at quit, never under work that still writes to them. */
  private readonly retiredDbs: Database[] = [];
  private cachedEmbedder: Embedder | null = null;
  private cachedIngestion: IngestionService | null = null;
  private cachedGoalWorker: GoalWorker | null = null;

  constructor(
    readonly version: string,
    readonly settingsFile: string,
    defaultDataFolder: string,
  ) {
    this.settings = new SettingsStore(settingsFile, defaultDataFolder);
    this.ensureFolders();
    this.sessionWork.subscribe((event) => this.emit('session.work', event));
    this.sessionMaker.subscribe((maker) => this.emit('session.maker', { maker }));
  }

  paths() {
    return dataPaths(this.settings.get().dataFolder);
  }

  provider(): LlmProvider {
    if (!this.cachedProvider) this.cachedProvider = createProvider(this.settings.get(), this.paths().agentCwd);
    return this.cachedProvider;
  }

  db(): Database {
    if (!this.cachedDb) {
      this.cachedDb = openDatabase(this.paths().db);
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

  /** After a restart, pick up goals whose material was still being read, profiled or compiled. */
  /** What sessions and practice need to run and grade; grades are announced to the renderer. */
  practiceDeps() {
    return {
      db: this.db(),
      provider: this.provider(),
      ingestion: this.ingestion(),
      attachmentsDir: this.paths().attachments,
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
    this.cachedProvider?.reconfigure(createInnerProvider(next, this.paths().agentCwd), next.concurrency);
    this.cachedIngestion?.setConcurrency(next.concurrency);
    if (next.dataFolder === previous.dataFolder) return;
    if (this.cachedDb) this.retiredDbs.push(this.cachedDb);
    this.cachedDb = null;
    this.cachedEmbedder = null;
    this.cachedIngestion = null;
    this.cachedGoalWorker = null;
    this.ensureFolders();
  }

  close(): void {
    for (const db of [this.cachedDb, ...this.retiredDbs]) db?.close();
    this.cachedDb = null;
    this.retiredDbs.length = 0;
  }

  private ensureFolders(): void {
    const p = this.paths();
    for (const dir of [p.root, p.sources, p.exports, p.modelsCache, p.agentCwd, p.attachments]) mkdirSync(dir, { recursive: true });
  }
}
