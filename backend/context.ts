import { mkdirSync } from 'node:fs';
import type { EventSink } from './api/handlers';
import { TransformersEmbedder } from './ingest/embedder';
import type { Embedder } from './ingest/embedder';
import { createProvider } from './llm';
import type { LlmProvider } from './llm/provider';
import type { IdeaFinished } from './core/cards';
import { IngestionService } from './services/ingestion';
import { queueIdeaCards } from './services/cards';
import type { CardWriterDeps } from './services/cards';
import { GoalWorker, nextGoalStep } from './services/goalWorker';
import { listGoals } from './store/goals';
import { SettingsStore, dataPaths } from './settings/store';
import { openDatabase } from './store/db';
import type { Database } from './store/db';

/** Everything the IPC handlers need. Built once in main.ts; pieces are rebuilt when settings change. */
export class AppContext {
  readonly settings: SettingsStore;
  emit: EventSink = () => {};
  private cachedProvider: LlmProvider | null = null;
  private cachedDb: Database | null = null;
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
  }

  paths() {
    return dataPaths(this.settings.get().dataFolder);
  }

  provider(): LlmProvider {
    if (!this.cachedProvider) this.cachedProvider = createProvider(this.settings.get(), this.paths().agentCwd);
    return this.cachedProvider;
  }

  db(): Database {
    if (!this.cachedDb) this.cachedDb = openDatabase(this.paths().db);
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
      this.cachedGoalWorker = new GoalWorker({ db: () => this.db(), provider: () => this.provider(), ingestion: () => this.ingestion(), onChange: (goalId) => this.emit('goals.changed', { goalId }) });
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

  onSettingsChanged(): void {
    this.cachedProvider = null;
    this.cachedIngestion = null;
    this.cachedEmbedder = null;
    if (this.cachedDb) {
      this.cachedDb.close();
      this.cachedDb = null;
    }
    this.ensureFolders();
  }

  close(): void {
    this.cachedDb?.close();
    this.cachedDb = null;
  }

  private ensureFolders(): void {
    const p = this.paths();
    for (const dir of [p.root, p.sources, p.exports, p.modelsCache, p.agentCwd, p.attachments]) mkdirSync(dir, { recursive: true });
  }
}
