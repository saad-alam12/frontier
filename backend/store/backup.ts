/**
 * Copies of the database. Everything the learner has built up (the map, the evidence, sessions,
 * flashcards) lives in one file, so it is copied: once a day the app is opened, before every schema
 * upgrade, and before a restore. `VACUUM INTO` writes a consistent copy while the database is in use.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { localDate } from '../core/dates';
import type { Database } from './db';

export type BackupKind = 'daily' | 'manual' | 'upgrade' | 'restore';

export interface BackupInfo {
  file: string;
  kind: BackupKind;
  /** When the copy was made. */
  at: string;
  bytes: number;
}

/** How many copies of each kind are kept; the oldest go first. */
const KEEP: Record<BackupKind, number> = { daily: 7, manual: 5, upgrade: 3, restore: 3 };
const NAME = /^frontier-(daily|manual|before-upgrade|before-restore)-[\w.-]+\.db$/;
const KIND: Record<string, BackupKind> = { daily: 'daily', manual: 'manual', 'before-upgrade': 'upgrade', 'before-restore': 'restore' };

/** True for a file name this module wrote: the only names a restore accepts. */
export function isBackupName(file: string): boolean {
  return NAME.test(file) && !file.includes('/') && !file.includes('\\');
}

const stamp = (now: Date) => `${localDate(now)}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

/** Write a copy of the database to `dir/file`. An existing file of that name is kept and nothing is written. */
function copyTo(db: Database, dir: string, file: string): boolean {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, file);
  if (existsSync(target)) return false;
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return true;
}

export function listBackups(dir: string): BackupInfo[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(isBackupName)
    .map((file) => {
      const stat = statSync(join(dir, file));
      return { file, kind: KIND[NAME.exec(file)?.[1] ?? 'manual'] ?? 'manual', at: stat.mtime.toISOString(), bytes: stat.size };
    })
    .sort((a, b) => b.at.localeCompare(a.at) || b.file.localeCompare(a.file));
}

function prune(dir: string): void {
  const seen: Partial<Record<BackupKind, number>> = {};
  for (const backup of listBackups(dir)) {
    const n = (seen[backup.kind] = (seen[backup.kind] ?? 0) + 1);
    if (n > KEEP[backup.kind]) rmSync(join(dir, backup.file), { force: true });
  }
}

/** Today's copy, made once per local day; older daily copies beyond the last seven are removed. Returns true when one was written. */
export function dailyBackup(db: Database, dir: string, now = new Date()): boolean {
  const written = copyTo(db, dir, `frontier-daily-${localDate(now)}.db`);
  if (written) prune(dir);
  return written;
}

/** A copy made because the learner asked for one. */
export function manualBackup(db: Database, dir: string, now = new Date()): void {
  copyTo(db, dir, `frontier-manual-${stamp(now)}.db`);
  prune(dir);
}

/** The data as it was before a schema upgrade, so the upgrade can be undone by hand if it goes wrong. */
export function upgradeBackup(db: Database, dir: string, fromVersion: number, now = new Date()): void {
  copyTo(db, dir, `frontier-before-upgrade-v${fromVersion}-${stamp(now)}.db`);
  prune(dir);
}

/** The data as it was before a restore replaced it, so a restore can itself be undone. */
export function restoreBackup(db: Database, dir: string, now = new Date()): void {
  copyTo(db, dir, `frontier-before-restore-${stamp(now)}.db`);
  prune(dir);
}
