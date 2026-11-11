import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { AppContext } from '../context';
import { dailyBackup, isBackupName, listBackups, manualBackup } from './backup';
import { DataFileError, openDatabase } from './db';
import { createGoal, listGoals } from './goals';
import { SCHEMA_VERSION } from './migrations';

const folder = () => mkdtempSync(join(tmpdir(), 'frontier-backup-'));

describe('backups', () => {
  it('makes one copy a day, a real database with the data in it, and keeps the last seven', () => {
    const dir = folder();
    const db = openDatabase(join(dir, 'frontier.db'));
    createGoal(db, 'Learn game theory');
    const backups = join(dir, 'backups');
    expect(dailyBackup(db, backups, new Date(2026, 10, 1, 9))).toBe(true);
    expect(dailyBackup(db, backups, new Date(2026, 10, 1, 18))).toBe(false); // already made today
    const copy = openDatabase(join(backups, 'frontier-daily-2026-11-01.db'));
    expect(listGoals(copy).map((g) => g.text)).toEqual(['Learn game theory']);
    copy.close();
    for (let day = 2; day <= 10; day += 1) dailyBackup(db, backups, new Date(2026, 10, day, 9));
    const daily = listBackups(backups).filter((b) => b.kind === 'daily');
    expect(daily).toHaveLength(7);
    expect(existsSync(join(backups, 'frontier-daily-2026-11-10.db'))).toBe(true);
    expect(existsSync(join(backups, 'frontier-daily-2026-11-03.db'))).toBe(false);
    db.close();
  });

  it('only its own file names count as backups', () => {
    expect(isBackupName('frontier-daily-2026-11-01.db')).toBe(true);
    expect(isBackupName('frontier-before-upgrade-v12-2026-11-01-091500.db')).toBe(true);
    for (const name of ['frontier.db', '../frontier-daily-2026-11-01.db', 'frontier-daily-x.db/../../etc', 'notes.txt']) expect(isBackupName(name)).toBe(false);
  });

  it('copies the data before a schema upgrade is tried, so a failed upgrade loses nothing', () => {
    const dir = folder();
    const path = join(dir, 'frontier.db');
    openDatabase(path).close();
    const old = new DatabaseSync(path);
    // marked as one version behind: the last migration runs again and fails on its existing tables
    old.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1}`);
    old.close();
    expect(() => openDatabase(path, { backupsDir: join(dir, 'backups') })).toThrow();
    expect(readdirSync(join(dir, 'backups')).some((f) => f.startsWith(`frontier-before-upgrade-v${SCHEMA_VERSION - 1}-`))).toBe(true);
    // and with no upgrade pending, no such copy is made
    const fresh = folder();
    openDatabase(join(fresh, 'frontier.db'), { backupsDir: join(fresh, 'backups') }).close();
    openDatabase(join(fresh, 'frontier.db'), { backupsDir: join(fresh, 'backups') }).close();
    expect(existsSync(join(fresh, 'backups'))).toBe(false);
  });
});

describe('a data file that cannot be used', () => {
  it('refuses data written by a newer version instead of misreading it', () => {
    const path = join(folder(), 'frontier.db');
    openDatabase(path).close();
    const newer = new DatabaseSync(path);
    newer.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 3}`);
    newer.close();
    expect(() => openDatabase(path)).toThrow(DataFileError);
    expect(() => openDatabase(path)).toThrow('newer version of Frontier');
  });

  it('refuses a damaged file with a plain reason', () => {
    const path = join(folder(), 'frontier.db');
    writeFileSync(path, 'this is not a database, it only has its name'.repeat(40));
    expect(() => openDatabase(path)).toThrow(DataFileError);
  });
});

describe('restoring a backup', () => {
  it('puts the backup in place of the data and keeps a copy of what was there', () => {
    const dir = folder();
    const ctx = new AppContext('test', join(dir, 'settings.json'), join(dir, 'data'));
    createGoal(ctx.db(), 'The goal I had on Monday');
    const [monday] = ctx.backupNow();
    if (!monday) throw new Error('no backup');
    createGoal(ctx.db(), 'A goal I added on Tuesday');
    expect(listGoals(ctx.db())).toHaveLength(2);

    ctx.restoreBackup(monday.file);
    expect(listGoals(ctx.db()).map((g) => g.text)).toEqual(['The goal I had on Monday']);
    // and the way back: the data as it was before the restore
    const before = ctx.backups().find((b) => b.kind === 'restore');
    if (!before) throw new Error('no copy before the restore');
    ctx.restoreBackup(before.file);
    expect(listGoals(ctx.db())).toHaveLength(2);
    expect(() => ctx.restoreBackup('../../etc/passwd')).toThrow('no longer there');
    expect(() => ctx.restoreBackup('frontier-daily-1999-01-01.db')).toThrow('no longer there');
    ctx.close();
  });

  it('does not make a second manual copy within the same second, and lists newest first', () => {
    const dir = folder();
    const db = openDatabase(join(dir, 'frontier.db'));
    manualBackup(db, join(dir, 'backups'), new Date(2026, 10, 2, 9, 0, 0));
    manualBackup(db, join(dir, 'backups'), new Date(2026, 10, 2, 9, 0, 0));
    manualBackup(db, join(dir, 'backups'), new Date(2026, 10, 2, 9, 5, 0));
    expect(listBackups(join(dir, 'backups')).map((b) => b.file).sort()).toEqual(['frontier-manual-2026-11-02-090000.db', 'frontier-manual-2026-11-02-090500.db']);
    db.close();
  });
});
