import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { listChains, listNodes } from './world';
import { openDatabase } from './db';
import { runMigrations, SCHEMA_VERSION } from './migrations';
import { createSource, searchPassages } from './sources';
import { seedExampleGraph } from './seed/exampleGraph';
import { recordEvidence } from '../services/evidence';
import { listEvidenceForNode } from './evidence';

/** The schema the first R7 session left on the owner's Mac, before pictures of pages (16). */
const OLD_VERSION = 15;

describe('upgrading an older database', () => {
  it('keeps every idea, chain, source and answer, indexes old passages for Lookup and backs up first', () => {
    const folder = mkdtempSync(join(tmpdir(), 'frontier-upgrade-'));
    const path = join(folder, 'frontier.db');
    // a database as an older version wrote it
    const old = new DatabaseSync(path);
    old.exec('PRAGMA foreign_keys = ON');
    runMigrations(old, OLD_VERSION);
    expect((old.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(OLD_VERSION);
    const ids = seedExampleGraph(old as unknown as Parameters<typeof seedExampleGraph>[0]);
    const nash = ids.get('nash') as string;
    createSource(old as unknown as Parameters<typeof createSource>[0], { kind: 'pdf', title: 'Lecture 5', path: null, hash: 'l5' }, [{ text: 'Threats that are not credible are ruled out by subgame perfection.', locator: 'p7' }]);
    recordEvidence(old as unknown as Parameters<typeof recordEvidence>[0], { nodeId: nash, kind: 'explain', score: 0.9, reasoning: 'learned before the upgrade' });
    const nodes = listNodes(old as unknown as Parameters<typeof listNodes>[0]).length;
    const chains = listChains(old as unknown as Parameters<typeof listChains>[0]).length;
    old.close();

    const db = openDatabase(path, { backupsDir: join(folder, 'backups') });
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
    expect(listNodes(db)).toHaveLength(nodes);
    expect(listChains(db)).toHaveLength(chains);
    expect(listEvidenceForNode(db, nash).map((e) => e.reasoning)).toContain('learned before the upgrade');
    // passages written before the index existed are found
    expect(searchPassages(db, ['credible'])[0]?.locator).toBe('p7');
    // tables of later versions are there and empty
    for (const table of ['source_figures', 'dialogues', 'idea_notes', 'watched_folders', 'model_calls']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
    // a copy of the data as it was is kept before the schema changes
    expect(readdirSync(join(folder, 'backups')).length).toBeGreaterThan(0);
    db.close();
  });
});
