import { describe, expect, it } from 'vitest';
import type { FrontierMap, FrontierState } from '../../backend/api/contract';
import { DOT_RADIUS, layoutFrontier, pointOnCubic } from './frontierLayout';
import type { FrontierLayout, LabelBox } from './frontierLayout';

/** A small deterministic generator so the cases are random-looking but repeatable. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function randomMap(seed: number): FrontierMap {
  const next = rng(seed);
  const states: FrontierState[] = ['owned', 'learnable', 'beyond'];
  const count = 2 + Math.floor(next() * 11);
  const nodes = [{ id: 'n0', name: 'Iterated elimination of strictly dominated strategies', state: 'current' as FrontierState }];
  for (let i = 1; i < count; i += 1) nodes.push({ id: `n${i}`, name: 'Idea '.repeat(1 + Math.floor(next() * 8)).trim(), state: states[Math.floor(next() * 3)] as FrontierState });
  const edges: [string, string][] = [];
  for (let i = 1; i < count; i += 1) edges.push([`n${Math.floor(next() * i)}`, `n${i}`]);
  return { nodes, edges, edgeCount: 3 };
}

const overlaps = (a: LabelBox, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function check(layout: FrontierLayout) {
  const { nodes } = layout;
  for (const n of nodes) {
    expect(n.label.x).toBeGreaterThanOrEqual(0);
    expect(n.label.x + n.label.width).toBeLessThanOrEqual(layout.width);
    expect(n.label.y).toBeGreaterThanOrEqual(0);
    expect(n.label.y + n.label.height).toBeLessThanOrEqual(layout.height);
  }
  for (const a of nodes) {
    for (const b of nodes) {
      const r = DOT_RADIUS[b.state];
      const dot = { x: b.x - r, y: b.y - r, width: 2 * r, height: 2 * r };
      expect(overlaps(a.label, dot), `label ${a.id} touches point ${b.id}`).toBe(false);
      if (a.id === b.id) continue;
      expect(overlaps(a.label, b.label), `labels ${a.id} and ${b.id} overlap`).toBe(false);
      const gap = Math.hypot(a.x - b.x, a.y - b.y);
      expect(gap).toBeGreaterThan(DOT_RADIUS[a.state] + r);
    }
  }
  for (const segment of layout.edgeLine) {
    for (let t = 0; t <= 1; t += 0.02) {
      const [x, y] = pointOnCubic(segment, t);
      for (const n of nodes) expect(overlaps(n.label, { x, y, width: 0.01, height: 0.01 }), `edge line crosses label ${n.id}`).toBe(false);
    }
  }
}

describe('frontier map layout', () => {
  it('never lets labels touch each other, the points or the edge line', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      for (const width of [280, 360, 440, 480]) check(layoutFrontier(randomMap(seed), width));
    }
  });

  it('keeps owned ideas left of the edge line, the rest right of it, and passes the line through the current idea', () => {
    const layout = layoutFrontier(randomMap(7), 440);
    const current = layout.nodes.find((n) => n.state === 'current');
    const edgeX = layout.edgeLine[0]?.[0][0] ?? 0;
    for (const n of layout.nodes) expect(n.state === 'owned' ? n.x < edgeX : n.x > edgeX).toBe(true);
    const through = layout.edgeLine.some((seg) => seg[3][0] === current?.x && seg[3][1] === current?.y);
    expect(through).toBe(true);
  });

  it('gives the same picture for the same map', () => {
    expect(layoutFrontier(randomMap(3), 440)).toEqual(layoutFrontier(randomMap(3), 440));
  });
});
