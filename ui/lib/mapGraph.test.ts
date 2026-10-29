import { describe, expect, it } from 'vitest';
import type { MapNodeView, MapView } from '../../backend/api/contract';
import { DEFAULT_SETTINGS, buildGraph, growthOrder, mergeSettings, neighbourhood, adjacency, placeLabels, radiusOf, visibleIdeas } from './mapGraph';
import type { LabelBox } from './mapGraph';

const node = (id: string, patch: Partial<MapNodeView> = {}): MapNodeView => ({
  id,
  name: id,
  kind: 'claim',
  state: 'beyond',
  depth: 0,
  recall: 0,
  unverified: false,
  goals: [],
  simplified: false,
  topic: null,
  learnedAt: null,
  ...patch,
});

// a, b → c (two premises: a junction); c → d; e is loose
const view: Pick<MapView, 'nodes' | 'chains'> = {
  nodes: [node('a', { state: 'owned', depth: 2 }), node('b', { state: 'fringe' }), node('c', { goals: ['g1'], simplified: true }), node('d'), node('e', { state: 'fringe' })],
  chains: [
    { id: 'k1', premises: ['a', 'b'], conclusion: 'c' },
    { id: 'k2', premises: ['c'], conclusion: 'd' },
  ],
};

describe('map graph', () => {
  it('filters by state, goal scope, simplified, loose ideas and neighbourhood', () => {
    const all = visibleIdeas(view, DEFAULT_SETTINGS, null);
    expect([...all].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect([...visibleIdeas(view, { ...DEFAULT_SETTINGS, show: { owned: false, fringe: true, beyond: true } }, null)].sort()).toEqual(['b', 'c', 'd', 'e']);
    // a goal shows its targets and everything they are built on
    expect([...visibleIdeas(view, { ...DEFAULT_SETTINGS, goalId: 'g1' }, null)].sort()).toEqual(['a', 'b', 'c']);
    expect([...visibleIdeas(view, { ...DEFAULT_SETTINGS, simplifiedOnly: true }, null)]).toEqual(['c']);
    expect(visibleIdeas(view, { ...DEFAULT_SETTINGS, hideLoose: true }, null).has('e')).toBe(false);
    // the local graph ignores the state filter: one step from c
    expect([...visibleIdeas(view, { ...DEFAULT_SETTINGS, show: { owned: false, fringe: false, beyond: true } }, { id: 'c', hops: 1 })].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('joins a chain with several premises at a junction, and layers ideas from the roots', () => {
    const g = buildGraph(view, visibleIdeas(view, DEFAULT_SETTINGS, null));
    const junction = g.nodes.find((n) => n.junction);
    expect(junction?.id).toBe('junction:k1');
    expect(g.links.map((l) => `${l.source}>${l.target}`).sort()).toEqual(['a>junction:k1', 'b>junction:k1', 'c>d', 'junction:k1>c'].sort());
    const layer = new Map(g.nodes.map((n) => [n.id, n.layer]));
    expect([layer.get('a'), layer.get('c'), layer.get('d'), layer.get('junction:k1')]).toEqual([0, 1, 2, 0.5]);
    expect(g.nodes.find((n) => n.id === 'c')?.dependents).toBe(1);
    // a hidden premise drops out of its chain; a chain with none left is gone
    const partial = buildGraph(view, new Set(['b', 'c', 'd']));
    expect(partial.links.map((l) => `${l.source}>${l.target}`).sort()).toEqual(['b>c', 'c>d']);
    expect(partial.nodes.some((n) => n.junction)).toBe(false);
  });

  it('finds neighbourhoods along chains in both directions', () => {
    const near = adjacency(view.chains);
    expect([...neighbourhood('d', near, 1)].sort()).toEqual(['c', 'd']);
    expect([...neighbourhood('d', near, 2)].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('places labels greedily without overlaps, most important first, inside the view', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed / 2 ** 31);
    const boxes: LabelBox[] = Array.from({ length: 600 }, (_, i) => ({ id: `n${i}`, x: random() * 1400 - 50, y: random() * 900 - 20, w: 40 + random() * 160, h: 16, priority: i % 7 }));
    const placed = placeLabels(boxes, 1280, 820);
    expect(placed.length).toBeGreaterThan(40);
    for (const [i, a] of placed.entries()) {
      expect(a.x >= 0 && a.y >= 0 && a.x + a.w <= 1280 && a.y + a.h <= 820).toBe(true);
      for (const b of placed.slice(i + 1)) expect(a.x < b.x + b.w + 4 && b.x < a.x + a.w + 4 && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
    }
    // the top priority label always gets in when it fits
    const top = placeLabels([{ id: 'low', x: 10, y: 10, w: 100, h: 16, priority: 1 }, { id: 'high', x: 20, y: 12, w: 100, h: 16, priority: 9 }], 400, 400);
    expect(top.map((b) => b.id)).toEqual(['high']);
    // nothing runs under an overlay
    expect(placeLabels([{ id: 'under', x: 10, y: 10, w: 100, h: 16, priority: 9 }], 400, 400, [{ x: 0, y: 0, w: 60, h: 40 }])).toEqual([]);
  });

  it('sizes foundations larger, replays growth in learning order, and reads old settings safely', () => {
    expect(radiusOf({ state: 'beyond', depth: 0 }, 9, 1)).toBeGreaterThan(radiusOf({ state: 'beyond', depth: 0 }, 0, 1));
    expect(growthOrder([node('x'), node('y', { learnedAt: '2026-10-02' }), node('z', { learnedAt: '2026-10-01' })])).toEqual(['z', 'y', 'x']);
    expect(mergeSettings({ repel: 0.9, colorBy: 'nonsense', show: { owned: false } })).toMatchObject({ repel: 0.9, colorBy: 'state', show: { owned: false, fringe: true, beyond: true } });
    expect(mergeSettings('garbage')).toEqual(DEFAULT_SETTINGS);
  });
});
