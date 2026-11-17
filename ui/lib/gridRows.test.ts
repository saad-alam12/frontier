import { describe, expect, it } from 'vitest';
import { spanningCards } from './gridRows';

describe('spanningCards (R8 E6)', () => {
  it('leaves pairs alone and widens a lone last card', () => {
    expect(spanningCards([false, false])).toEqual([false, false]);
    expect(spanningCards([false, false, false])).toEqual([false, false, true]);
    expect(spanningCards([false])).toEqual([true]);
  });

  it('widens a card left alone before a wide one, as Misconceptions before Time against plans', () => {
    // Time per week (wide), six cards in pairs, Misconceptions, Time against plans (wide)
    expect(spanningCards([true, false, false, false, false, false, false, false, true])).toEqual([true, false, false, false, false, false, false, true, true]);
  });

  it('counts rows afresh after a wide card', () => {
    expect(spanningCards([false, true, false, false, false])).toEqual([true, true, false, false, true]);
    expect(spanningCards([])).toEqual([]);
  });
});
