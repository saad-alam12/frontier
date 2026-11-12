import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CHOICES, SettingsPatchSchema, SettingsSchema, modelChoice } from './schema';
import { SettingsStore } from './store';

describe('model and effort per role', () => {
  const defaults = SettingsSchema.parse({});

  it('uses the owner defaults, including the escalation role', () => {
    expect(modelChoice(defaults, 'goalCompiler')).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' });
    expect(modelChoice(defaults, 'extractor')).toEqual({ model: 'claude-haiku-5-5', effort: 'medium' });
    expect(modelChoice(defaults, 'tutorEscalation')).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' });
    expect(modelChoice(defaults, 'examiner')).toEqual({ model: 'claude-opus-5-5', effort: 'medium' });
    expect(Object.keys(DEFAULT_CHOICES)).toHaveLength(14);
  });

  it("takes overrides; a changed model without an effort gets that model's default", () => {
    const s = SettingsSchema.parse({ models: { tutor: 'claude-sonnet-5-5', grader: '' }, efforts: { planner: 'low' } });
    expect(modelChoice(s, 'tutor')).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' });
    expect(modelChoice(s, 'grader')).toEqual(DEFAULT_CHOICES.grader);
    expect(modelChoice(s, 'planner')).toEqual({ model: 'claude-haiku-5-5', effort: 'low' });
    expect(modelChoice(SettingsSchema.parse({ models: { tutor: 'my-custom-model' } }), 'tutor')).toEqual({ model: 'my-custom-model', effort: 'high' });
  });
});

describe('settings store', () => {
  it('keeps overrides across patches and resets an effort with null', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { SettingsStore } = await import('./store');
    const store = new SettingsStore(join(mkdtempSync(join(tmpdir(), 'frontier-settings-')), 'settings.json'), '/data');
    store.update({ efforts: { tutor: 'high', planner: 'low' } });
    store.update({ models: { tutor: 'claude-sonnet-5-5' } });
    expect(store.get().efforts).toEqual({ tutor: 'high', planner: 'low' });
    store.update({ efforts: { tutor: null } });
    expect(store.get().efforts).toEqual({ planner: 'low' });
    expect(modelChoice(store.get(), 'tutor')).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' });
  });
});

describe('a settings patch changes only what it names', () => {
  const file = () => join(mkdtempSync(join(tmpdir(), 'frontier-settings-')), 'settings.json');

  it('keeps the provider, the key and the data folder when another field changes (the path the Settings screen takes)', () => {
    const path = file();
    writeFileSync(path, JSON.stringify({ provider: 'anthropicApi', apiKey: 'sk-test', dataFolder: '/my/folder', concurrency: 3 }));
    const store = new SettingsStore(path, '/default');
    store.update(SettingsPatchSchema.parse({ concurrency: 5 }));
    store.update(SettingsPatchSchema.parse({ efforts: { tutor: 'high' } }));
    store.update(SettingsPatchSchema.parse({ models: { grader: 'claude-haiku-5-5' } }));
    expect(store.get()).toMatchObject({ provider: 'anthropicApi', apiKey: 'sk-test', dataFolder: '/my/folder', concurrency: 5, efforts: { tutor: 'high' }, models: { grader: 'claude-haiku-5-5' } });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ provider: 'anthropicApi', apiKey: 'sk-test', dataFolder: '/my/folder' });
  });

  it('a parsed patch holds no defaults, and an unknown field is refused', () => {
    expect(SettingsPatchSchema.parse({ concurrency: 5 })).toEqual({ concurrency: 5 });
    expect(SettingsPatchSchema.parse({})).toEqual({});
    expect(() => SettingsPatchSchema.parse({ theme: 'light' })).toThrow();
    expect(() => SettingsPatchSchema.parse({ concurrency: 12 })).toThrow();
  });

  it('leaves no temporary file behind', () => {
    const path = file();
    new SettingsStore(path, '/default').update({ concurrency: 2 });
    expect(readdirSync(join(path, '..'))).toEqual(['settings.json']);
  });
});

describe('a settings file with a bad field', () => {
  it('keeps every valid field and a copy of the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontier-settings-'));
    const path = join(dir, 'settings.json');
    const written = JSON.stringify({ provider: 'anthropicApi', apiKey: 'sk-test', dataFolder: '/my/folder', concurrency: 12, models: { tutor: 'claude-sonnet-5-5', retiredRole: 'x' }, efforts: { planner: 'low', tutor: 'huge' } });
    writeFileSync(path, written);
    const settings = new SettingsStore(path, '/default').get();
    expect(settings).toEqual({ reminderDaily: true, reminderTime: '18:00', iconBadge: true, pythonPath: '', preset: 'balanced', provider: 'anthropicApi', apiKey: 'sk-test', dataFolder: '/my/folder', concurrency: 3, models: { tutor: 'claude-sonnet-5-5' }, efforts: { planner: 'low' } });
    expect(readFileSync(join(dir, 'settings.unreadable.json'), 'utf8')).toBe(written);
  });

  it('falls back to the defaults when the file is not JSON at all', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'frontier-settings-')), 'settings.json');
    writeFileSync(path, '{ not json');
    expect(new SettingsStore(path, '/default').get()).toEqual({ ...SettingsSchema.parse({}), dataFolder: '/default' });
  });
});

describe('the API key in the keychain', () => {
  /** A stand-in keychain: reversible, and visibly not the key. */
  const box = (available = true) => ({
    available: () => available,
    seal: (text: string) => Buffer.from(`sealed:${text}`).toString('base64'),
    open: (sealed: string) => {
      const text = Buffer.from(sealed, 'base64').toString();
      if (!text.startsWith('sealed:')) throw new Error('cannot open');
      return text.slice('sealed:'.length);
    },
  });
  const file = async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    return join(mkdtempSync(join(tmpdir(), 'frontier-keychain-')), 'settings.json');
  };

  it('writes the key sealed, never in plain text, and reads it back', async () => {
    const { readFileSync } = await import('node:fs');
    const { SettingsStore } = await import('./store');
    const path = await file();
    new SettingsStore(path, '/data', box()).update({ provider: 'anthropicApi', apiKey: 'sk-ant-secret' });
    const onDisk = readFileSync(path, 'utf8');
    expect(onDisk).not.toContain('sk-ant-secret');
    expect(JSON.parse(onDisk)).toMatchObject({ apiKey: '', apiKeySealed: expect.any(String) });
    expect(new SettingsStore(path, '/data', box()).get().apiKey).toBe('sk-ant-secret');
  });

  it('seals a key left in plain text by an older version the first time it reads the file', async () => {
    const { readFileSync, writeFileSync } = await import('node:fs');
    const { SettingsStore } = await import('./store');
    const path = await file();
    writeFileSync(path, JSON.stringify({ provider: 'anthropicApi', apiKey: 'sk-ant-old' }));
    expect(new SettingsStore(path, '/data', box()).get().apiKey).toBe('sk-ant-old');
    expect(readFileSync(path, 'utf8')).not.toContain('sk-ant-old');
  });

  it('keeps the key as before when there is no keychain, and says when a sealed key cannot be opened', async () => {
    const { readFileSync, writeFileSync } = await import('node:fs');
    const { SettingsStore } = await import('./store');
    const path = await file();
    new SettingsStore(path, '/data', box(false)).update({ apiKey: 'sk-ant-plain' });
    expect(readFileSync(path, 'utf8')).toContain('sk-ant-plain');
    writeFileSync(path, JSON.stringify({ apiKeySealed: Buffer.from('from another computer').toString('base64') }));
    const store = new SettingsStore(path, '/data', box());
    expect(store.get().apiKey).toBe('');
    expect(store.keyLost).toBe(true);
  });
});
