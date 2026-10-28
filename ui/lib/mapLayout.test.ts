import { describe, expect, it } from 'vitest';
import { LABEL_HEIGHT, MARKER_OFFSET, ROW, layoutMap } from './mapLayout';
import type { MapLayoutInput } from './mapLayout';

/** A random prerequisite graph: each idea after the first few builds on one to three earlier ones. */
function randomGraph(size: number, seed = 1): MapLayoutInput {
  let s = seed;
  const next = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const nodes = Array.from({ length: size }, (_, i) => ({ id: `n${i}`, name: `Idea number ${i} with a fairly long name` }));
  const chains: MapLayoutInput['chains'] = [];
  for (let i = 8; i < size; i += 1) {
    if (next() < 0.12) continue; // some ideas have no chains at all
    const k = 1 + Math.floor(next() * 3);
    const premises = [...new Set(Array.from({ length: k }, () => `n${Math.floor(next() * i)}`))];
    chains.push({ id: `c${i}`, premises, conclusion: `n${i}` });
    if (next() < 0.1) chains.push({ id: `c${i}b`, premises: [`n${Math.floor(next() * i)}`], conclusion: `n${i}` });
  }
  return { nodes, chains };
}

describe('map layout', () => {
  it('lays out 600 ideas quickly, with no label touching another label or a point', () => {
    const input = randomGraph(600);
    const t0 = performance.now();
    const layout = layoutMap(input);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(layout.nodes).toHaveLength(600);
    // within a column, rows are at least ROW apart; across columns, labels end before the next column's markers
    const byKey = new Map<string, number>();
    for (const n of layout.nodes) {
      const key = `${n.x}:${n.y}`;
      expect(byKey.has(key), `two ideas at ${key}`).toBe(false);
      byKey.set(key, 1);
    }
    const sorted = [...layout.nodes].sort((a, b) => a.x - b.x || a.y - b.y);
    for (let i = 1; i < sorted.length; i += 1) {
      const a = sorted[i - 1];
      const b = sorted[i];
      if (a && b && a.x === b.x) expect(b.y - a.y).toBeGreaterThanOrEqual(ROW - 1e-9);
    }
    expect(ROW).toBeGreaterThan(LABEL_HEIGHT);
    for (const n of layout.nodes) expect(n.label.x + n.label.width).toBeLessThan(n.x + 240 - MARKER_OFFSET);
  });

  it('puts every conclusion right of the premises of its shortest chain, and marks joint premises', () => {
    const layout = layoutMap({
      nodes: ['strategy', 'payoff', 'profile', 'br', 'nash', 'loner'].map((id) => ({ id, name: id })),
      chains: [
        { id: 'c1', premises: ['strategy'], conclusion: 'profile' },
        { id: 'c2', premises: ['strategy', 'payoff'], conclusion: 'br' },
        { id: 'c3', premises: ['profile', 'br'], conclusion: 'nash' },
      ],
    });
    const at = new Map(layout.nodes.map((n) => [n.id, n]));
    expect(at.get('strategy')?.layer).toBe(0);
    expect(at.get('br')?.layer).toBe(1);
    expect(at.get('nash')?.layer).toBe(2);
    expect(at.get('loner')?.layer).toBe(-1); // no chains: in the grid below
    expect(at.get('loner')?.y).toBeGreaterThan(Math.max(...['strategy', 'payoff', 'profile', 'br', 'nash'].map((id) => at.get(id)?.y ?? 0)));
    expect(layout.markers.map((m) => m.chainId).sort()).toEqual(['c2', 'c3']);
    expect(layout.links.filter((l) => l.chainId === 'c1')).toHaveLength(1);
  });

  it('is deterministic and survives cycles', () => {
    const input = randomGraph(120, 7);
    expect(layoutMap(input)).toEqual(layoutMap(input));
    const cyclic = layoutMap({ nodes: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }], chains: [{ id: 'x', premises: ['a'], conclusion: 'b' }, { id: 'y', premises: ['b'], conclusion: 'a' }] });
    expect(cyclic.nodes).toHaveLength(2);
  });
});
