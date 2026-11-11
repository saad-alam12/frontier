import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppContext } from './context';

function context() {
  const dir = mkdtempSync(join(tmpdir(), 'frontier-context-'));
  return { ctx: new AppContext('test', join(dir, 'settings.json'), join(dir, 'data')), dir };
}
const count = (db: ReturnType<AppContext['db']>) => (db.prepare('SELECT count(*) AS n FROM goals').get() as { n: number }).n;

describe('settings changes and the database', () => {
  it('keeps the database open when a model, an effort or the limit changes, so work in flight can finish', () => {
    const { ctx } = context();
    const db = ctx.db();
    const ingestion = ctx.ingestion();
    const provider = ctx.provider();
    for (const patch of [{ models: { tutor: 'claude-sonnet-5-5' } }, { efforts: { planner: 'low' as const } }, { concurrency: 5 }]) {
      const previous = ctx.settings.get();
      ctx.settings.update(patch);
      ctx.onSettingsChanged(previous);
    }
    expect(ctx.db()).toBe(db);
    expect(count(db)).toBe(0); // the handle that work in flight holds still answers
    expect(ctx.ingestion()).toBe(ingestion); // sources being read stay known to the one service
    expect(ctx.provider()).toBe(provider); // services keep their provider; it now uses the new settings
    ctx.close();
  });

  it('opens another database for another data folder and closes the old one only at quit', () => {
    const { ctx, dir } = context();
    const old = ctx.db();
    const previous = ctx.settings.get();
    ctx.settings.update({ dataFolder: join(dir, 'elsewhere') });
    ctx.onSettingsChanged(previous);
    expect(ctx.db()).not.toBe(old);
    expect(count(old)).toBe(0); // still open: work that started in the old folder can write to it
    ctx.close();
    expect(() => count(old)).toThrow();
  });
});
