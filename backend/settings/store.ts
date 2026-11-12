import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SettingsSchema, salvageSettings, type Settings, type SettingsPatch } from './schema';
import type { SecretBox } from './secrets';

/**
 * Settings live in a small JSON file because the data folder path must be known before the database
 * opens. The API key is written sealed by the system's keychain (`apiKeySealed`) when there is one;
 * a key found in plain text from before is sealed the first time the file is read.
 */
export class SettingsStore {
  private current: Settings;
  /** The key on disk could not be opened (the file came from another computer): it must be entered again. */
  keyLost = false;

  constructor(
    private readonly filePath: string,
    private readonly defaultDataFolder: string,
    private readonly secrets?: SecretBox,
  ) {
    this.current = this.read();
  }

  /** Whether the key is kept sealed by a keychain (false where the system offers none). */
  sealsKeys(): boolean {
    return this.secrets?.available() ?? false;
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
    writeFileSync(temporary, JSON.stringify(this.onDisk(), null, 2));
    renameSync(temporary, this.filePath);
  }

  /** The settings as written: the key sealed when the keychain can seal it, else as it is. */
  private onDisk(): Record<string, unknown> {
    if (!this.current.apiKey || !this.secrets?.available()) return { ...this.current };
    return { ...this.current, apiKey: '', apiKeySealed: this.secrets.seal(this.current.apiKey) };
  }

  /** The key from the file: opened from its seal, or as written in plain text before keys were sealed. */
  private withKey(settings: Settings, raw: unknown): { settings: Settings; plain: boolean } {
    const sealed = raw && typeof raw === 'object' ? (raw as { apiKeySealed?: unknown }).apiKeySealed : undefined;
    if (typeof sealed === 'string' && sealed && this.secrets?.available()) {
      try {
        return { settings: { ...settings, apiKey: this.secrets.open(sealed) }, plain: false };
      } catch {
        this.keyLost = true;
        return { settings: { ...settings, apiKey: '' }, plain: false };
      }
    }
    return { settings, plain: Boolean(settings.apiKey) };
  }

  /**
   * A file that does not parse as a whole is never thrown away: a copy is kept beside it
   * (`settings.unreadable.json`) and every field that is still valid is used.
   */
  private read(): Settings {
    if (!existsSync(this.filePath)) return SettingsSchema.parse({});
    let raw: unknown = null;
    let parsed: Settings;
    try {
      raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      parsed = SettingsSchema.parse(raw);
    } catch {
      try {
        copyFileSync(this.filePath, join(dirname(this.filePath), 'settings.unreadable.json'));
      } catch {
        // the copy is a courtesy; reading goes on without it
      }
      parsed = salvageSettings(raw);
    }
    const { settings, plain } = this.withKey(parsed, raw);
    // a key from before keys were sealed is sealed now, and leaves the file in plain text
    if (plain && this.secrets?.available()) {
      this.current = settings;
      try {
        this.write();
      } catch {
        // the key stays as it was until the next change of settings
      }
    }
    return settings;
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
    /** Frontier's own Python environment, made from the Python on the computer, for running the learner's code. */
    python: join(dataFolder, 'python'),
    backups: join(dataFolder, 'backups'),
  };
}
