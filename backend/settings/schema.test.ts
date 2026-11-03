import { describe, expect, it } from 'vitest';
import { DEFAULT_CHOICES, SettingsSchema, modelChoice } from './schema';

describe('model and effort per role', () => {
  const defaults = SettingsSchema.parse({});

  it('uses the owner defaults, including the escalation role', () => {
    expect(modelChoice(defaults, 'goalCompiler')).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' });
    expect(modelChoice(defaults, 'extractor')).toEqual({ model: 'claude-haiku-5-5', effort: 'medium' });
    expect(modelChoice(defaults, 'tutorEscalation')).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' });
    expect(Object.keys(DEFAULT_CHOICES)).toHaveLength(11);
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
