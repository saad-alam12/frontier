import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeProvider } from '../llm/FakeProvider';
import { ThrottledProvider } from '../llm/queue';
import type { CompleteResult, Role } from '../llm/provider';
import { DEFAULT_CHOICES, PRESET_CHOICES, SettingsSchema, modelChoice, salvageSettings } from '../settings/schema';
import { openDatabase } from '../store/db';
import { recordModelCall } from '../store/modelCalls';
import { usageView } from './usage';

describe('model presets (R7 A3)', () => {
  it('a preset sets every job; a job set by hand keeps its setting', () => {
    const balanced = SettingsSchema.parse({});
    expect(balanced.preset).toBe('balanced');
    expect(modelChoice(balanced, 'tutor')).toEqual(DEFAULT_CHOICES.tutor);
    const light = SettingsSchema.parse({ preset: 'light' });
    expect(modelChoice(light, 'tutor')).toEqual(PRESET_CHOICES.light.tutor);
    expect(modelChoice(light, 'tutor').model).toBe('claude-sonnet-5-5');
    const best = SettingsSchema.parse({ preset: 'best', models: { extractor: 'claude-haiku-5-5' }, efforts: { tutor: 'low' } });
    expect(modelChoice(best, 'extractor').model).toBe('claude-haiku-5-5');
    expect(modelChoice(best, 'tutor')).toEqual({ model: 'claude-opus-5-5', effort: 'low' });
    expect(modelChoice(best, 'grader')).toEqual(PRESET_CHOICES.best.grader);
    expect(salvageSettings({ preset: 'light', concurrency: 'lots' }).preset).toBe('light');
  });

  it('every preset names a model and an effort for every job', () => {
    for (const preset of Object.values(PRESET_CHOICES)) expect(Object.keys(preset).sort()).toEqual(Object.keys(DEFAULT_CHOICES).sort());
  });
});

describe('usage (R7 A3)', () => {
  it('every call that answered is counted, and counting never fails a call', async () => {
    const counted: Role[] = [];
    const inner = new FakeProvider({ tutor: [{ x: 'ok' }] });
    const provider = new ThrottledProvider(inner, 2, undefined, (role: Role, result: CompleteResult<unknown>) => {
      counted.push(role);
      expect(result.model).toBe('fake');
      throw new Error('the database is busy');
    });
    const result = await provider.complete({ role: 'tutor', system: 's', messages: [{ role: 'user', content: 'hi' }], submit: { name: 'submit', description: 'd', schema: z.object({ x: z.string() }) } });
    expect(result.data).toEqual({ x: 'ok' });
    expect(counted).toEqual(['tutor']);
  });

  it('sums today and the last seven days, cache reads included, with the jobs that used most', () => {
    const db = openDatabase(':memory:');
    const now = new Date(2026, 10, 12, 15, 0);
    const call = (role: string, input: number, cached: number, daysAgo: number) =>
      recordModelCall(db, { role, model: 'm', inputTokens: input, outputTokens: 100, cacheReadTokens: cached, cacheWriteTokens: 0, costUsd: null }, new Date(now.getTime() - daysAgo * 86_400_000).toISOString());
    call('tutor', 1000, 3000, 0);
    call('tutor', 1000, 3000, 0);
    call('extractor', 20000, 0, 3);
    call('grader', 500, 0, 9); // older than a week
    const usage = usageView(db, now);
    expect(usage.today).toEqual({ calls: 2, inputTokens: 8000, outputTokens: 200, cacheReadTokens: 6000 });
    expect(usage.week.calls).toBe(3);
    expect(usage.topJobs.map((j) => j.role)).toEqual(['extractor', 'tutor']);
  });
});
