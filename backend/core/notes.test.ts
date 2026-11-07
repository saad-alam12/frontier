import { describe, expect, it } from 'vitest';
import { goalNotes, notesFileName, reachedWord } from './notes';

describe('a goal as notes', () => {
  it('writes skills, ideas, own words and flashcards, each idea once', () => {
    const nash = { name: 'Nash equilibrium', statement: 'No player gains by changing alone.', reached: 'Explain', ownWords: 'Nobody wants to move first.', handle: 'the standoff', cards: [{ front: 'State the condition', back: '$$u_i(s) \\ge u_i(s_i\', s_{-i})$$\nfor all $i$' }] };
    const text = goalNotes({
      title: 'Game theory exam',
      text: 'Pass the game theory exam',
      context: 'Written exam in December.',
      scope: 'Solve small games.',
      exportedOn: '7 November 2026',
      skills: [
        { statement: 'Can find equilibria', ideas: [nash, { name: 'Best response', statement: 'The best reply.', reached: null, ownWords: null, handle: null, cards: [] }] },
        { statement: 'Can use dominance', ideas: [nash] },
      ],
    });
    expect(text.startsWith('# Game theory exam\n\nPass the game theory exam\n\n> Written exam in December.')).toBe(true);
    expect(text).toContain('### Nash equilibrium\n\nNo player gains by changing alone.\n\n*Learned to: Explain*');
    expect(text).toContain('**In my words:** Nobody wants to move first.');
    expect(text).toContain("  **A:** $u_i(s) \\ge u_i(s_i', s_{-i})$ for all $i$");
    expect(text).toContain('*Not learned yet*');
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
