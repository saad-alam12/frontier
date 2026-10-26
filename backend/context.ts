import { mkdirSync } from 'node:fs';
import { createProvider } from './llm';
import type { LlmProvider } from './llm/provider';
import { SettingsStore, dataPaths } from './settings/store';

/** Everything the IPC handlers need. Built once in main.ts; rebuilt pieces when settings change. */
export class AppContext {
  readonly settings: SettingsStore;
  private cachedProvider: LlmProvider | null = null;

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

  onSettingsChanged(): void {
    this.cachedProvider = null;
    this.ensureFolders();
  }

  private ensureFolders(): void {
    const p = this.paths();
    for (const dir of [p.root, p.sources, p.exports, p.modelsCache, p.agentCwd]) mkdirSync(dir, { recursive: true });
  }
}
