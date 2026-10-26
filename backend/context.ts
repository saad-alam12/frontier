import { mkdirSync } from 'node:fs';
import type { EventSink } from './api/handlers';
import { TransformersEmbedder } from './ingest/embedder';
import type { Embedder } from './ingest/embedder';
import { createProvider } from './llm';
import type { LlmProvider } from './llm/provider';
import { IngestionService } from './services/ingestion';
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
      });
    }
    return this.cachedIngestion;
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
    for (const dir of [p.root, p.sources, p.exports, p.modelsCache, p.agentCwd]) mkdirSync(dir, { recursive: true });
  }
}
