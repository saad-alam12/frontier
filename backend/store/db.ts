import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrations';

export type Database = DatabaseSync;

/** Open (or create) the database and bring the schema up to date. `:memory:` for tests. */
export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  runMigrations(db);
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
