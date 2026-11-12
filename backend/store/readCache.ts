/**
 * Reads kept while the data they come from is unchanged (D23: speed as the map grows). Two keys say
 * when: `cachedRead` keeps a value until anything is written to the database (SQLite counts every
 * row a connection inserts, updates or deletes, and `data_version` moves when another connection
 * commits); `cachedForWorld` keeps a value until nodes or chains change, which only the merger's
 * writes do (`worldChanged`), so what is derived from the graph alone survives answers, reviews and
 * study time. A rolled-back savepoint drops both (`forgetReads`). Only for values that do not depend
 * on the clock, and that callers do not change.
 */
import type { Database } from './db';

interface Kept {
  version: string | number;
  values: Map<string, unknown>;
}

const byData = new WeakMap<Database, Kept>();
const byWorld = new WeakMap<Database, Kept>();
const worldVersions = new WeakMap<Database, number>();

function dataVersion(db: Database): string {
  const changes = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
  const other = (db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
  return `${changes}:${other}`;
}

function keep<T>(store: WeakMap<Database, Kept>, db: Database, version: string | number, key: string, compute: () => T, stillValid: () => boolean): T {
  let kept = store.get(db);
  if (!kept || kept.version !== version) {
    kept = { version, values: new Map() };
    store.set(db, kept);
  }
  if (kept.values.has(key)) return kept.values.get(key) as T;
  const value = compute();
  // a compute that wrote something (it should not) is not kept: its value may already be out of date
  if (stillValid()) kept.values.set(key, value);
  return value;
}

/** `compute()`, kept until the next write to the database. */
export function cachedRead<T>(db: Database, key: string, compute: () => T): T {
  const version = dataVersion(db);
  return keep(byData, db, version, key, compute, () => dataVersion(db) === version);
}

/** `compute()`, kept until nodes or chains next change. */
export function cachedForWorld<T>(db: Database, key: string, compute: () => T): T {
  const version = worldVersions.get(db) ?? 0;
  return keep(byWorld, db, version, key, compute, () => (worldVersions.get(db) ?? 0) === version);
}

/** Called by every write to nodes and chains (`store/worldWrites.ts`). */
export function worldChanged(db: Database): void {
  worldVersions.set(db, (worldVersions.get(db) ?? 0) + 1);
}

/** Drop every kept read: a savepoint was rolled back, and the change counter does not go back with the data. */
export function forgetReads(db: Database): void {
  byData.delete(db);
  worldChanged(db);
}
