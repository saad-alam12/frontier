import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SettingsSchema, type Settings, type SettingsPatch } from './schema';

/** Settings live in a small JSON file because the data folder path must be known before the database opens. */
export class SettingsStore {
  private current: Settings;

  constructor(
    private readonly filePath: string,
    private readonly defaultDataFolder: string,
  ) {
    this.current = this.read();
  }

  get(): Settings {
    return { ...this.current, dataFolder: this.current.dataFolder || this.defaultDataFolder };
  }

  update(patch: SettingsPatch): Settings {
    this.current = SettingsSchema.parse({ ...this.current, ...patch, models: { ...this.current.models, ...(patch.models ?? {}) } });
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.current, null, 2));
    return this.get();
  }

  private read(): Settings {
    if (!existsSync(this.filePath)) return SettingsSchema.parse({});
    try {
      return SettingsSchema.parse(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch {
      return SettingsSchema.parse({});
    }
  }
}

export function dataPaths(dataFolder: string) {
  return {
    root: dataFolder,
    db: join(dataFolder, 'frontier.db'),
    sources: join(dataFolder, 'sources'),
    exports: join(dataFolder, 'exports'),
    modelsCache: join(dataFolder, 'models-cache'),
    agentCwd: join(dataFolder, 'agent'),
  };
}
