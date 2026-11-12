import { describe, expect, it } from 'vitest';
import { dryRun, openDatabase, transaction } from './db';
import { cachedForWorld, cachedRead } from './readCache';
import { setSetting } from './settingsTable';
import { createUnverifiedNodes } from './worldWrites';

describe('kept reads', () => {
  it('a read is kept until the next write, and read again after it', () => {
    const db = openDatabase(':memory:');
    let computed = 0;
    const read = () => cachedRead(db, 'count', () => (computed += 1));
    expect(read()).toBe(1);
    expect(read()).toBe(1);
    setSetting(db, 'x', '1');
    expect(read()).toBe(2);
  });

  it('a rolled-back change, or a dry run, does not leave a read of the data it undid', () => {
    const db = openDatabase(':memory:');
    const value = () => cachedRead(db, 'x', () => (db.prepare("SELECT value FROM settings WHERE key = 'x'").get() as { value: string } | undefined)?.value ?? null);
    setSetting(db, 'x', 'before');
    dryRun(db, () => {
      setSetting(db, 'x', 'inside');
      expect(value()).toBe('inside');
    });
    expect(value()).toBe('before');
    expect(() =>
      transaction(db, () => {
        setSetting(db, 'x', 'failed');
        expect(value()).toBe('failed');
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(value()).toBe('before');
  });

  it('what comes from the map alone survives other writes, and is read again when the map changes', () => {
    const db = openDatabase(':memory:');
    let computed = 0;
    const read = () => cachedForWorld(db, 'graph', () => (computed += 1));
    expect(read()).toBe(1);
    setSetting(db, 'x', '1'); // an answer, a review, study time: not the map
    expect(read()).toBe(1);
    createUnverifiedNodes(db, [{ id: 'node_a', kind: 'claim', name: 'A', statement: 'A.', aliases: [] }]);
    expect(read()).toBe(2);
  });

  it('a read that writes while it is worked out is not kept', () => {
    const db = openDatabase(':memory:');
    let computed = 0;
    const read = () =>
      cachedRead(db, 'writes', () => {
        computed += 1;
        setSetting(db, 'n', String(computed));
        return computed;
      });
    expect(read()).toBe(1);
    expect(read()).toBe(2);
  });
});
