import { describe, expect, it } from 'vitest';
import { cheatSheet, goalNotes, notesFileName, reachedWord, shorten } from './notes';
import type { SheetInputIdea } from './notes';

describe('a goal as notes', () => {
  it('writes skills, ideas, own words and flashcards, each idea once', () => {
    const nash = { name: 'Nash equilibrium', statement: 'No player gains by changing alone.', reached: 'Explain', ownWords: 'Nobody wants to move first.', handle: 'the standoff', note: 'Check the corners first.', examples: ['Firms at (10, 10): neither gains by raising alone.'], cards: [{ front: 'State the condition', back: '$$u_i(s) \\ge u_i(s_i\', s_{-i})$$\nfor all $i$' }] };
    const text = goalNotes({
      title: 'Game theory exam',
      text: 'Pass the game theory exam',
      context: 'Written exam in December.',
      scope: 'Solve small games.',
      exportedOn: '7 November 2026',
      skills: [
        { statement: 'Can find equilibria', ideas: [nash, { name: 'Best response', statement: 'The best reply.', reached: null, ownWords: null, handle: null, note: null, examples: [], cards: [] }] },
        { statement: 'Can use dominance', ideas: [nash] },
      ],
    });
    expect(text.startsWith('# Game theory exam\n\nPass the game theory exam\n\n> Written exam in December.')).toBe(true);
    expect(text).toContain('### Nash equilibrium\n\nNo player gains by changing alone.\n\n*Learned to: Explain*');
    expect(text).toContain('**In my words:** Nobody wants to move first.');
    expect(text).toContain("  **A:** $u_i(s) \\ge u_i(s_i', s_{-i})$ for all $i$");
    expect(text).toContain('*Not learned yet*');
    expect(text).toContain('**My note**\n\nCheck the corners first.');
    expect(text).toContain('**Worked example**\n\nFirms at (10, 10): neither gains by raising alone.');
    expect(text.match(/### Nash equilibrium/g)).toHaveLength(1);
    expect(text).toContain('- Nash equilibrium (above)');
    expect(text).not.toMatch(/\n{3}/);
  });

  it('names the file after the title, without characters files cannot hold', () => {
    expect(notesFileName('Understand $\\mathbf{x}$: vectors / matrices')).toBe('Understand mathbf{x} vectors matrices.md');
    expect(notesFileName('  ')).toBe('Goal.md');
  });

  it('says how far an idea was learned in the ladder\u2019s words', () => {
    expect(reachedWord(0)).toBeNull();
    expect(reachedWord(2)).toBe('explain it');
    expect(reachedWord(5)).toBe('transfer it');
  });
});

describe('the cheat sheet', () => {
  const idea = (nodeId: string, over: Partial<SheetInputIdea> = {}): SheetInputIdea => ({ nodeId, name: `Idea ${nodeId}`, statement: `What ${nodeId} says.`, ownWords: null, handle: null, cards: [], core: false, learned: true, recall: 0.9, ...over });

  it('writes each idea once, in the learner\u2019s words when they have them, with its formulas', () => {
    const sheet = cheatSheet([
      { statement: 'Skill one', ideas: [idea('a', { ownWords: 'In my words.', cards: [{ front: 'Condition', back: '$u_i \\ge u_i\'$' }, { front: 'Who', back: 'Nash' }] }), idea('b')] },
      { statement: 'Skill two', ideas: [idea('a'), idea('c')] },
    ]);
    expect(sheet.left).toBe(0);
    expect(sheet.skills.map((s) => s.ideas.map((i) => i.nodeId))).toEqual([['a', 'b'], ['c']]);
    expect(sheet.skills[0]?.ideas[0]?.text).toBe('In my words.');
    expect(sheet.skills[0]?.ideas[0]?.formulas).toEqual([{ front: 'Condition', back: "$u_i \\ge u_i'$" }]);
  });

  it('keeps core and fading ideas first when the page is full, and everything when asked', () => {
    const long = 'x '.repeat(150);
    const ideas = [idea('fresh', { statement: long, recall: 0.95 }), idea('core', { statement: long, core: true }), idea('fading', { statement: long, recall: 0.4 }), idea('new', { statement: long, learned: false, recall: null })];
    const sheet = cheatSheet([{ statement: 'Skill', ideas }], { budget: 700 });
    expect(sheet.skills[0]?.ideas.map((i) => i.nodeId)).toEqual(['core', 'fading']);
    expect(sheet.left).toBe(2);
    expect(cheatSheet([{ statement: 'Skill', ideas }], { all: true, budget: 700 }).left).toBe(0);
    // one idea always shows, even when it alone is longer than the page
    expect(cheatSheet([{ statement: 'Skill', ideas: [idea('big', { statement: long })] }], { budget: 10 }).left).toBe(0);
  });

  it('shortens text at a word, never inside a formula', () => {
    expect(shorten('short text', 50)).toBe('short text');
    expect(shorten('one two three four five six', 15)).toBe('one two three…');
    expect(shorten('the value is $a + b + c + d$ and more after it', 20)).toBe('the value is…');
    expect(shorten('first $$x^2 + y^2 = z^2$$ then more words here', 16)).toBe('first…');
  });
});
