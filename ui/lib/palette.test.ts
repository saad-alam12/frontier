import { describe, expect, it } from 'vitest';
import { matchScore, rankItems } from './palette';
import type { PaletteItem } from './palette';

const items: PaletteItem[] = [
  { id: 'p:cards', group: 'Places', label: 'Cards', keywords: ['flashcards', 'review'] },
  { id: 'p:map', group: 'Places', label: 'Map' },
  { id: 'a:new-goal', group: 'Actions', label: 'New goal' },
  { id: 'a:review', group: 'Actions', label: 'Review flashcards' },
  { id: 'g:1', group: 'Goals', label: 'Game theory exam' },
  { id: 'i:1', group: 'Ideas', label: 'Nash equilibrium' },
  { id: 'i:2', group: 'Ideas', label: 'Subgame perfect equilibrium' },
];

describe('the command palette', () => {
  it('ranks a whole-word start above a match inside a word', () => {
    expect(matchScore('Nash equilibrium', 'nash')).toBeGreaterThan(matchScore('Subgame perfect equilibrium', 'equi'));
    expect(matchScore('Nash equilibrium', 'nash eq')).toBeGreaterThan(0);
    expect(matchScore('Nash equilibrium', 'xyz')).toBe(0);
  });

  it('finds places by their other names, and ranks a label above another name', () => {
    expect(rankItems(items, 'flash').map((i) => i.id)).toEqual(['a:review', 'p:cards']);
    expect(rankItems(items, 'review').map((i) => i.id)).toEqual(['a:review', 'p:cards']);
    expect(rankItems(items, 'equilibrium').map((i) => i.id)).toEqual(['i:1', 'i:2']);
    expect(rankItems(items, 'game').map((i) => i.id)).toEqual(['g:1', 'i:2']);
  });

  it('shows actions, then places, then goals, with no query', () => {
    expect(rankItems(items, '', 4).map((i) => i.group)).toEqual(['Actions', 'Actions', 'Places', 'Places']);
  });
});
