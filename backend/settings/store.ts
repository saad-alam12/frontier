import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SettingsSchema, salvageSettings, type Settings, type SettingsPatch } from './schema';

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
    // only the fields the patch names change; a field left out (or undefined) keeps its value
    const named = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    const efforts: Record<string, unknown> = { ...this.current.efforts, ...(patch.efforts ?? {}) };
    for (const [role, effort] of Object.entries(efforts)) if (effort === null) delete efforts[role];
    this.current = SettingsSchema.parse({ ...this.current, ...named, models: { ...this.current.models, ...(patch.models ?? {}) }, efforts });
    this.write();
    return this.get();
  }

  /** Written to a temporary file first, then renamed, so a crash mid-write never leaves half a file. */
  private write(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.current, null, 2));
    renameSync(temporary, this.filePath);
  }

  /**
   * A file that does not parse as a whole is never thrown away: a copy is kept beside it
   * (`settings.unreadable.json`) and every field that is still valid is used.
   */
  private read(): Settings {
    if (!existsSync(this.filePath)) return SettingsSchema.parse({});
    let raw: unknown = null;
    try {
      raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return SettingsSchema.parse(raw);
    } catch {
      try {
        copyFileSync(this.filePath, join(dirname(this.filePath), 'settings.unreadable.json'));
      } catch {
        // the copy is a courtesy; reading goes on without it
      }
      return salvageSettings(raw);
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
    attachments: join(dataFolder, 'attachments'),
    figures: join(dataFolder, 'figures'),
    backups: join(dataFolder, 'backups'),
  };
}
