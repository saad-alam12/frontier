import { describe, expect, it } from 'vitest';
import { buildTermIndex, findTerms, wordKey } from './terms';

const index = buildTermIndex([
  { id: 'nash', names: ['Nash equilibrium', 'NE'] },
  { id: 'eq', names: ['Equilibrium'] },
  { id: 'br', names: ['Best response'] },
  { id: 'strategy', names: ['Strategy'] },
  { id: 'bezier', names: ['Bézier curve'] },
  { id: 'alpha', names: ['$\\alpha$-level'] },
  { id: 'iesds', names: ['Iterated elimination of strictly dominated strategies', 'IESDS'] },
]);
const found = (text: string, exclude: string[] = []) => findTerms(text, index, new Set(exclude)).map((m) => [m.id, text.slice(m.start, m.end)]);

describe('hover definitions: the matcher (R8 E2)', () => {
  it('matches whole words, the longest name first, without overlaps', () => {
    expect(found('A Nash equilibrium is an equilibrium where each plays a best response.')).toEqual([
      ['nash', 'Nash equilibrium'],
      ['eq', 'equilibrium'],
      ['br', 'best response'],
    ]);
    // never inside a word
    expect(found('Disequilibrium and strategyless play')).toEqual([]);
  });

  it('reads simple plurals and possessives, any case', () => {
    expect(found('Both STRATEGIES are best responses; the equilibrium’s payoff')).toEqual([
      ['strategy', 'STRATEGIES'],
      ['br', 'best responses'],
      ['eq', 'equilibrium’s'],
    ]);
    expect(wordKey('processes')).toBe('process');
    expect(wordKey('class')).toBe('class');
    expect(wordKey('basis')).toBe('basis');
  });

  it('ignores accents, and reads LaTeX names by their words', () => {
    expect(found('A bezier curve, or a Bézier curve')).toEqual([
      ['bezier', 'bezier curve'],
      ['bezier', 'Bézier curve'],
    ]);
    expect(found('Pick the alpha level first.')).toEqual([['alpha', 'alpha level']]);
  });

  it('leaves out short names that would match too much, and very long ones', () => {
    // "NE" has no word of three letters; the six-plus word name is left out, its abbreviation is not
    expect(found('NE stands for it, and so does IESDS')).toEqual([['iesds', 'IESDS']]);
  });

  it('never matches the idea a question asks about, nor a shorter name inside it', () => {
    expect(found('Is this a Nash equilibrium or just an equilibrium?', ['nash'])).toEqual([['eq', 'equilibrium']]);
    expect(found('A best response', ['br'])).toEqual([]);
  });

  it('stays fast on thousands of names', () => {
    const many = buildTermIndex(Array.from({ length: 5000 }, (_, i) => ({ id: `n${i}`, names: [`idea number ${i} of the map`, `term${i}`] })));
    expect(many.size).toBe(10000);
    const text = Array.from({ length: 400 }, (_, i) => `See term${i * 7} and idea number ${i} of the map, then more words.`).join(' ');
    const start = performance.now();
    const matches = findTerms(text, many);
    const ms = performance.now() - start;
    expect(matches).toHaveLength(800);
    expect(ms).toBeLessThan(200);
  });
});
