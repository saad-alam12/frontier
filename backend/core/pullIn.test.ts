import { describe, expect, it } from 'vitest';
import { plainName, premiseToPullIn } from './pullIn';

const c = (id: string, name: string, hops = 1, aliases: string[] = []) => ({ id, name, aliases, hops });

describe('finding the prerequisite a gap names', () => {
  it('compares names without case, math markers or punctuation', () => {
    expect(plainName('The $\\mathbf{Dot}$ product.')).toBe('the mathbf dot product');
  });
  it('prefers an exact name or alias, then a name that holds the words, then the closer premise', () => {
    const candidates = [c('a', 'Best response', 2), c('b', 'Payoff function', 1, ['payoff']), c('d', 'Best response function', 1)];
    expect(premiseToPullIn('best response', candidates)).toBe('a');
    expect(premiseToPullIn('Payoff', candidates)).toBe('b');
    expect(premiseToPullIn('what a best response function is', candidates)).toBe('d');
  });
  it('finds nothing for a gap that is not among them, or too short to tell', () => {
    expect(premiseToPullIn('matrices', [c('a', 'Best response')])).toBeNull();
    expect(premiseToPullIn('BR', [c('a', 'Best response')])).toBeNull();
    expect(premiseToPullIn('', [c('a', 'Best response')])).toBeNull();
  });
});
