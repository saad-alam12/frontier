import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { upgradeBackup } from './backup';
import { SCHEMA_VERSION, runMigrations } from './migrations';
import { forgetReads } from './readCache';

export type Database = DatabaseSync;

/** The data file cannot be used as it is; the message is written for the learner. */
export class DataFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataFileError';
  }
}

/**
 * Open (or create) the database and bring the schema up to date. `:memory:` for tests. Before
 * anything is changed the file is checked: data written by a newer version of the app is refused
 * (older code would misread it), and so is a damaged file. With `backupsDir`, a copy is kept of the
 * data as it was before a schema upgrade.
 */
export function openDatabase(path: string, options: { backupsDir?: string } = {}): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version > SCHEMA_VERSION) {
      throw new DataFileError('This data was last opened by a newer version of Frontier. Open it with that version (or a newer one): this one would misread it.');
    }
    if (version > 0) {
      const check = (db.prepare('PRAGMA quick_check').get() as { quick_check: string } | undefined)?.quick_check;
      if (check !== 'ok') throw new DataFileError(`The data file is damaged (${check ?? 'it could not be checked'}).`);
      if (version < SCHEMA_VERSION && options.backupsDir) upgradeBackup(db, options.backupsDir, version);
    }
    runMigrations(db);
  } catch (error) {
    db.close();
    // a file that is not a database at all fails on its first statement
    if (error instanceof DataFileError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw /not a database|malformed|corrupt/i.test(message) ? new DataFileError(`The data file is damaged (${message}).`) : error;
  }
  return db;
}

const depths = new WeakMap<Database, number>();

/** Run `fn` atomically. Nested calls become savepoints, so a failure anywhere rolls back everything. */
export function transaction<T>(db: Database, fn: () => T): T {
  const depth = depths.get(db) ?? 0;
  const name = `sp${depth}`;
  db.exec(`SAVEPOINT ${name}`);
  depths.set(db, depth + 1);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (error) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    forgetReads(db); // the change counter does not go back with the data
    throw error;
  } finally {
    depths.set(db, depth);
  }
}

/**
 * Run `fn` inside a savepoint that is always rolled back: to preview what a change would do without
 * making it. `fn` must be synchronous.
 */
export function dryRun<T>(db: Database, fn: () => T): T {
  const depth = depths.get(db) ?? 0;
  const name = `sp${depth}`;
  db.exec(`SAVEPOINT ${name}`);
  depths.set(db, depth + 1);
  try {
    return fn();
  } finally {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    forgetReads(db); // the change counter does not go back with the data
    depths.set(db, depth);
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
