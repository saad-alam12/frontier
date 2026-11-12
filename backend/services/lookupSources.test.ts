import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { openDatabase } from '../store/db';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { createSource, deleteSource, resetSourceParts, searchPassages } from '../store/sources';
import { lookup, searchIdeas, searchTerms } from './lookup';

function setup() {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const lecture = createSource(db, { kind: 'pdf', title: 'Lecture 5: Sequential games', path: null, hash: 'l5' }, [
    { text: 'A subgame perfect equilibrium is a profile that is a Nash equilibrium in every subgame. Threats that are not credible are ruled out.', locator: 'p7' },
    { text: 'Backward induction solves a finite game tree from the last decision nodes upward.', locator: 'p9' },
  ]);
  return { db, id: (k: string) => ids.get(k) as string, lecture };
}

describe('Lookup over the learner’s sources', () => {
  it('keeps the words worth searching for', () => {
    expect(searchTerms('What is the difference between SPE and $u_i$ Nash?')).toEqual(['spe', 'nash']);
  });

  it('finds passages with their page, and follows the sources as they change', () => {
    const { db, lecture } = setup();
    const hits = searchPassages(db, ['credible', 'threats']);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ title: 'Lecture 5: Sequential games', locator: 'p7' });
    expect(hits[0]?.snippet).toContain('**credible**');
    // a source read again with new parts: the old text is gone from the index, the new one is in
    resetSourceParts(db, lecture.id, [{ text: 'Credibility of threats is the heart of the chapter.', locator: 'p2' }]);
    expect(searchPassages(db, ['backward'])).toEqual([]);
    expect(searchPassages(db, ['chapter'])[0]?.locator).toBe('p2');
    deleteSource(db, lecture.id);
    expect(searchPassages(db, ['chapter'])).toEqual([]);
  });

  it('cites the page of a part that spans pages where the words are', () => {
    const { db } = setup();
    createSource(db, { kind: 'pdf', title: 'Lecture 3', path: null, hash: 'l3' }, [{ text: '[p1]\nGames and players.\n\n[p6]\nA Nash equilibrium is a profile of mutual best responses.', locator: 'p1–p6' }]);
    const [hit] = searchPassages(db, ['mutual', 'responses']);
    expect(hit).toMatchObject({ title: 'Lecture 3', locator: 'p6', text: 'A Nash equilibrium is a profile of mutual best responses.' });
  });

  it('finds ideas named in a question by abbreviation or a telling word, with no search model', async () => {
    const { db, id } = setup();
    const hits = (await searchIdeas({ db }, 'difference between SPE and Nash')).map((h) => h.nodeId);
    expect(hits.slice(0, 2)).toEqual(expect.arrayContaining([id('spe'), id('nash')]));
  });

  it('answers from cards and passages, citing both, and takes a follow-up with the conversation', async () => {
    const { db, id } = setup();
    const librarian = (req: CompleteRequest<unknown>) => {
      const text = req.messages[0]?.content ?? '';
      const passage = /### \[(s\d)\] Lecture 5/.exec(text)?.[1];
      return { answer: text.includes('Follow-up question') ? 'Because a threat nobody would carry out cannot change what the other player does.' : 'An SPE is a Nash equilibrium in every subgame (Lecture 5, p7).', cited: [id('spe'), ...(passage ? [passage] : [])] };
    };
    const provider = new FakeProvider({ librarian });
    const first = await lookup({ db, provider }, 'What makes a subgame perfect equilibrium different from Nash?');
    expect(first.passages[0]).toMatchObject({ id: 's1', locator: 'p7' });
    expect(first.answer?.cited).toEqual([id('spe')]);
    expect(first.answer?.passages).toEqual(['s1']);
    expect(provider.calls[0]?.messages[0]?.content).toContain('## Passages from the learner’s sources'.replace('’', "'"));

    const second = await lookup({ db, provider }, 'and why are threats ruled out?', [{ question: 'What makes a subgame perfect equilibrium different from Nash?', answer: first.answer?.text ?? '' }]);
    expect(second.answer?.text).toMatch(/^Because a threat/);
    const asked = provider.calls[1]?.messages[0]?.content ?? '';
    expect(asked).toContain('## The conversation so far');
    expect(asked).toContain('## Follow-up question\nand why are threats ruled out?');
    // the question before keeps the subject: the SPE card is still there
    expect(second.hits.map((h) => h.nodeId)).toContain(id('spe'));
  });
  it('still shows what it found when the answer cannot be written', async () => {
    const { db } = setup();
    const provider = new FakeProvider({ librarian: () => Promise.reject(new Error('The model could not be reached.')) });
    const result = await lookup({ db, provider }, 'Why are threats that are not credible ruled out?');
    expect(result.answer).toBeNull();
    expect(result.answerError).toMatch(/could not be reached/);
    expect(result.passages.length).toBeGreaterThan(0);
  });
});
