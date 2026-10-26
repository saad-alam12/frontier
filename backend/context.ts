import { mkdirSync } from 'node:fs';
import { createProvider } from './llm';
import type { LlmProvider } from './llm/provider';
import { SettingsStore, dataPaths } from './settings/store';
import { openDatabase } from './store/db';
import type { Database } from './store/db';

/** Everything the IPC handlers need. Built once in main.ts; pieces are rebuilt when settings change. */
export class AppContext {
  readonly settings: SettingsStore;
  private cachedProvider: LlmProvider | null = null;
  private cachedDb: Database | null = null;

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

  onSettingsChanged(): void {
    this.cachedProvider = null;
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
