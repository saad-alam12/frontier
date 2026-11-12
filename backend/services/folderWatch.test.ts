import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Source } from '../core/types';
import { openDatabase } from '../store/db';
import { createGoal } from '../store/goals';
import { createSource } from '../store/sources';
import { FolderWatcher, watchedFolderViews } from './folderWatch';

const watchers: FolderWatcher[] = [];
afterEach(() => watchers.splice(0).forEach((w) => w.stop()));

function setup() {
  const db = openDatabase(':memory:');
  const folder = mkdtempSync(join(tmpdir(), 'frontier-watch-'));
  const calls: { path: string; goalId: string | null }[] = [];
  let n = 0;
  const watcher = new FolderWatcher({
    db: () => db,
    addFile: async (path, goalId) => {
      calls.push({ path, goalId });
      if (path.endsWith('broken.pdf')) throw new Error('broken.pdf is not a readable PDF.');
      n += 1;
      const source = createSource(db, { kind: 'markdown', title: path.split('/').pop() ?? path, path: null, hash: `h${n}-${path}` }, [{ text: 'x', locator: 'start' }]) as Source;
      return { source, existed: false };
    },
  });
  watchers.push(watcher);
  return { db, folder, calls, watcher };
}

describe('watched folders', () => {
  it('adds the files a folder holds, then only what is new or changed, and skips what is not material', async () => {
    const { db, folder, calls, watcher } = setup();
    writeFileSync(join(folder, 'lecture1.md'), '# One');
    writeFileSync(join(folder, '.DS_Store'), 'x');
    writeFileSync(join(folder, '~$lecture1.docx'), 'lock');
    writeFileSync(join(folder, 'photo.jpg'), 'not material');
    mkdirSync(join(folder, 'week 2'));
    writeFileSync(join(folder, 'week 2', 'lecture2.md'), '# Two');
    expect(await watcher.add(folder, null)).toBe(2);
    expect(calls.map((c) => c.path.slice(folder.length + 1))).toEqual(['lecture1.md', 'week 2/lecture2.md']);

    // nothing new: nothing added
    expect(await watcher.scan(folder)).toBe(0);
    // a new lecture, and one that changed
    writeFileSync(join(folder, 'lecture3.md'), '# Three');
    writeFileSync(join(folder, 'lecture1.md'), '# One, corrected and longer');
    expect(await watcher.scan(folder)).toBe(2);
    const views = await watchedFolderViews(db);
    expect(views[0]).toMatchObject({ files: 3, goalId: null, present: true, problems: [] });
  });

  it('adds a goal folder’s files for the goal, and notes a file it cannot read once', async () => {
    const { db, folder, calls, watcher } = setup();
    const goal = createGoal(db, { text: 'Pass the game theory exam' });
    writeFileSync(join(folder, 'broken.pdf'), 'not a pdf');
    writeFileSync(join(folder, 'notes.md'), '# Notes');
    expect(await watcher.add(folder, goal.id)).toBe(1);
    expect(calls.every((c) => c.goalId === goal.id)).toBe(true);
    const tries = calls.length;
    await watcher.scan(folder);
    expect(calls.length).toBe(tries); // unchanged: not tried again
    const views = await watchedFolderViews(db);
    expect(views[0]?.goalTitle).toBe('Pass the game theory exam');
    expect(views[0]?.problems).toEqual([{ name: 'broken.pdf', error: 'broken.pdf is not a readable PDF.' }]);
    watcher.remove(folder);
    expect(await watchedFolderViews(db)).toEqual([]);
  });

  it('refuses what is not a folder', async () => {
    const { folder, watcher } = setup();
    writeFileSync(join(folder, 'file.md'), 'x');
    await expect(watcher.add(join(folder, 'file.md'), null)).rejects.toThrow(/not a folder/);
  });
});
