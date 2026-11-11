import { describe, expect, it } from 'vitest';
import { passageFor } from './passage';

const page = (n: number, body: string) => `[p${n}]\n${body}`;
const filler = (word: string, n: number) => Array.from({ length: n }, (_, i) => `${word} sentence ${i}.`).join(' ');
const paper = [
  page(1, `Title and abstract. ${filler('Abstract', 150)}`),
  page(2, filler('Background', 150)),
  page(3, `${filler('Setup', 60)} Scaled dot-product attention divides the dot products by the square root of the key dimension. ${filler('Detail', 60)}`),
  page(4, `Positional encoding adds sines and cosines of different frequencies. ${filler('More', 40)}`),
  page(5, filler('Results', 100)),
].join('\n\n');

describe('the passage that teaches an idea', () => {
  it('is the cited page, not the start of the source', () => {
    const passage = passageFor(paper, 'p4', 'Positional encoding');
    expect(passage.startsWith('[p4]')).toBe(true);
    expect(passage).toContain('sines and cosines');
    expect(passage).not.toContain('Title and abstract');
    expect(passage.length).toBeLessThanOrEqual(1810);
  });

  it('centres on the idea when its page is longer than the limit', () => {
    const passage = passageFor(paper, 'p3', 'Scaled dot-product attention');
    expect(passage).toContain('divides the dot products by the square root');
    expect(passage.startsWith('…')).toBe(true);
    expect(passage).not.toContain('[p4]');
  });

  it('follows a page range and merged page markers', () => {
    const range = passageFor(paper, 'p3–p4', 'Positional encoding');
    expect(range).toContain('sines and cosines');
    const slides = '[p1]\nIntro.\n\n[p2–p4]\nNash equilibrium: no player gains by deviating alone.\n\n[p5]\nOutlook.';
    expect(passageFor(slides, 'p3', 'Nash equilibrium')).toContain('[p1]'); // p3 sits inside a merged run: no marker of its own
    expect(passageFor(slides, 'p2', 'Nash equilibrium')).toBe('[p2–p4]\nNash equilibrium: no player gains by deviating alone.');
    expect(passageFor(slides, 'p4', 'Nash equilibrium')).toBe('[p2–p4]\nNash equilibrium: no player gains by deviating alone.');
  });

  it('without a usable citation looks for the name, then falls back to the start', () => {
    expect(passageFor(paper, undefined, 'Positional encoding')).toContain('sines and cosines');
    expect(passageFor(paper, 'slide 99', 'Positional encoding')).toContain('sines and cosines');
    expect(passageFor(paper, undefined, 'An idea the text never names').startsWith('[p1]')).toBe(true);
    expect(passageFor('Short text.', 'p9', 'Anything')).toBe('Short text.');
  });

  it('headings work as markers too', () => {
    const notes = '[Intro]\nWhy games.\n\n[Intro > Nash]\nA profile where nobody gains alone.\n\n[Proofs]\nLater.';
    expect(passageFor(notes, 'Intro > Nash', 'Nash')).toBe('[Intro > Nash]\nA profile where nobody gains alone.');
  });
});
