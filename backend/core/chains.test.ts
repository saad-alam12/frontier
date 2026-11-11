import { describe, expect, it } from 'vitest';
import { chainKey, dedupeChains, simplifyChains } from './chains';
import type { Chain } from './types';

const chain = (id: string, premises: string[], conclusion: string, locator?: string): Chain => ({
  id,
  premises,
  conclusion,
  sources: [{ sourceId: 'src', locator }],
});

describe('chainKey and dedupe', () => {
  it('ignores premise order and duplicates', () => {
    expect(chainKey(['b', 'a', 'a'], 'c')).toBe(chainKey(['a', 'b'], 'c'));
  });

  it('merges sources of duplicate chains', () => {
    const out = dedupeChains([chain('x', ['a', 'b'], 'c', 'p1'), chain('y', ['b', 'a'], 'c', 'p2')]);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('x');
    expect(out[0]?.sources.map((s) => s.locator)).toEqual(['p1', 'p2']);
  });
});

describe('simplifyChains', () => {
  it('drops a chain whose premises are a strict superset of a kept chain', () => {
    const { kept, dropped } = simplifyChains([chain('long', ['a', 'b', 'x'], 'c'), chain('short', ['a', 'b'], 'c')]);
    expect(kept.map((c) => c.id)).toEqual(['short']);
    expect(dropped).toEqual([{ chain: expect.objectContaining({ id: 'long' }), reason: 'subset' }]);
  });

  it('keeps independent arguments for the same conclusion', () => {
    const { kept, dropped } = simplifyChains([chain('one', ['a', 'b'], 'c'), chain('two', ['d', 'e'], 'c')]);
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });

  it('drops a chain that only adds premises to a kept one', () => {
    const { kept, dropped } = simplifyChains([chain('ab', ['a'], 'b'), chain('bc', ['b'], 'c'), chain('abc', ['a', 'b'], 'c')]);
    expect(kept.map((c) => c.id).sort()).toEqual(['ab', 'bc']);
    expect(dropped[0]?.reason).toBe('subset');
    const more = simplifyChains([chain('pq', ['p'], 'q'), chain('qrs', ['q', 'r'], 's'), chain('prs', ['p', 'r'], 's'), chain('qrps', ['q', 'r', 'p'], 's')]);
    expect(more.kept.map((c) => c.id).sort()).toEqual(['pq', 'prs', 'qrs']);
    expect(more.dropped.map((d) => d.chain.id)).toEqual(['qrps']);
  });

  it('keeps a direct route beside a route through an idea built on the same premise', () => {
    // fractions + algebra -> equations ; equations -> percentages ; fractions -> percentages.
    // The direct route needs fractions only; the other needs algebra too. Both are real.
    const { kept, dropped } = simplifyChains([chain('eq', ['fractions', 'algebra'], 'equations'), chain('viaEq', ['equations'], 'percentages'), chain('direct', ['fractions'], 'percentages')]);
    expect(kept.map((c) => c.id).sort()).toEqual(['direct', 'eq', 'viaEq']);
    expect(dropped).toHaveLength(0);
  });

  it('does not loop on cycles', () => {
    const { kept } = simplifyChains([chain('ab', ['a'], 'b'), chain('ba', ['b'], 'a'), chain('abc', ['a', 'b'], 'c')]);
    expect(kept).toHaveLength(3);
  });
});
