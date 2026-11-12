import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { openDatabase } from '../store/db';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { createSource } from '../store/sources';
import { citedPage, locatorLabel } from '../core/locators';
import { lookup } from './lookup';
import { sourceDocument } from './sourceView';

function setup() {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const dir = mkdtempSync(join(tmpdir(), 'frontier-sources-'));
  return { db, dir, id: (k: string) => ids.get(k) as string };
}

describe('the source viewer', () => {
  it('gives a PDF its own file, and its pages as text when the stored copy is gone', () => {
    const { db, dir } = setup();
    writeFileSync(join(dir, 'lecture.pdf'), Buffer.from('%PDF-1.4 stand-in'));
    const parts = [{ text: '[p1]\nGames.\n\n[p2]\nNash equilibrium.', locator: 'p1–p2' }];
    const kept = createSource(db, { kind: 'pdf', title: 'Lecture 3', path: 'lecture.pdf', hash: 'a' }, parts);
    const gone = createSource(db, { kind: 'pdf', title: 'Lecture 4', path: 'missing.pdf', hash: 'b' }, parts);
    const withFile = sourceDocument(db, dir, kept.id);
    expect(withFile).toMatchObject({ title: 'Lecture 3', kind: 'pdf', parts: [] });
    expect(Buffer.from(withFile.pdf ?? []).toString()).toBe('%PDF-1.4 stand-in');
    expect(sourceDocument(db, dir, gone.id)).toMatchObject({ pdf: null, parts: [{ locator: 'p1', text: 'Games.' }, { locator: 'p2', text: 'Nash equilibrium.' }] });
  });

  it('gives other sources the text of their parts, and says so when there is nothing to show', () => {
    const { db, dir } = setup();
    const notes = createSource(db, { kind: 'markdown', title: 'Notes', path: null, hash: 'c' }, [{ text: 'Best responses.', locator: 'Week 2 > Best responses' }]);
    expect(sourceDocument(db, dir, notes.id).parts).toEqual([{ locator: 'Week 2 > Best responses', text: 'Best responses.' }]);
    expect(() => sourceDocument(db, dir, 'src_missing')).toThrow('no longer in your library');
  });

  it('reads the page a citation names', () => {
    expect(citedPage('p12')).toBe(12);
    expect(citedPage('p2–p4')).toBe(2);
    expect(citedPage('Week 2 > Best responses')).toBeNull();
    expect(locatorLabel('p2–p4')).toBe('pp 2–4');
    expect(locatorLabel('p7')).toBe('p 7');
  });

  it('explains a selected passage, with what the map holds about it', async () => {
    const { db, id } = setup();
    const lecture = createSource(db, { kind: 'pdf', title: 'Lecture 5', path: null, hash: 'd' }, [{ text: 'A subgame perfect equilibrium is a Nash equilibrium in every subgame.', locator: 'p7' }]);
    const librarian = (req: CompleteRequest<unknown>) => {
      expect(req.messages[0]?.content).toContain('## The passage the learner selected (Lecture 5, p7)\nNash equilibrium in every subgame');
      return { answer: 'It asks for equilibrium play in every part of the game, not only along the path played.', cited: [id('spe')] };
    };
    const provider = new FakeProvider({ librarian });
    const result = await lookup({ db, provider }, 'What does this mean?', [], { sourceId: lecture.id, locator: 'p7', text: 'Nash equilibrium in every subgame' });
    expect(result.answer?.text).toMatch(/^It asks for equilibrium play/);
    expect(result.answer?.cited).toEqual([id('spe')]);
    // the selected passage itself is not offered again as a passage
    expect(result.passages.some((p) => p.sourceId === lecture.id && p.locator === 'p7')).toBe(false);
  });
});
