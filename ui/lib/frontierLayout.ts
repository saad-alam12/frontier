import type { FrontierMap, FrontierState } from '../../backend/api/contract';

/**
 * The side-panel map in pixels of the panel's actual width. Two stacks of rows: ideas you own on
 * the left (labels end at their point), everything else on the right (labels start at their
 * point; ideas beyond your edge one step further out). The dashed edge of knowledge runs down the gap between the stacks and bends out only to
 * pass through the current idea. Every label has a fixed box (text is cut with an ellipsis), so no
 * label can touch another label, a point or the dashed line, whatever the names are.
 */

const PAD_Y = 14;
const ROW = 30;
/** The current idea's row: two lines of the larger label. */
const CURRENT_ROW = 48;
const LABEL_GAP = 8;
/** Points sit this far from the edge line: owned to its left, the rest to its right. */
const LEFT_OFFSET = 24;
const RIGHT_OFFSET = 30;
/** Ideas beyond the edge sit one step further out than those learnable now. */
const BEYOND_INDENT = 26;

export const DOT_RADIUS: Record<FrontierState, number> = { owned: 4, learnable: 6, current: 7, beyond: 3.5 };
const LABEL_HEIGHT: Record<FrontierState, number> = { owned: 16, learnable: 17, beyond: 16, current: 42 };

export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
  align: 'left' | 'right';
}

export interface PlacedNode {
  id: string;
  name: string;
  state: FrontierState;
  x: number;
  y: number;
  label: LabelBox;
}

export type Point = [number, number];
/** A cubic Bézier segment: start, two control points, end. */
export type Cubic = [Point, Point, Point, Point];

export interface FrontierLayout {
  width: number;
  height: number;
  nodes: PlacedNode[];
  links: { from: string; to: string; path: string }[];
  /** The dashed edge line as cubic segments (straight runs are degenerate cubics). */
  edgeLine: Cubic[];
}

export function layoutFrontier(map: FrontierMap, width: number): FrontierLayout {
  const edgeX = Math.round(width * 0.42);
  const leftX = edgeX - LEFT_OFFSET;
  const rightX = edgeX + RIGHT_OFFSET;
  const neighbours = new Map<string, string[]>();
  for (const [a, b] of map.edges) {
    neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
    neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
  }
  const byName = (a: { name: string; id: string }, b: { name: string; id: string }) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const left = map.nodes.filter((n) => n.state === 'owned').sort(byName);
  const current = map.nodes.find((n) => n.state === 'current');
  const learnable = map.nodes.filter((n) => n.state === 'learnable').sort(byName);
  const beyond = map.nodes.filter((n) => n.state === 'beyond').sort(byName);

  // Order rows to keep links short: a few rounds of barycentre sorting against the other stack.
  let right = [...learnable, ...(current ? [current] : []), ...beyond];
  let leftOrder = left;
  const rank = (list: { id: string }[]) => new Map(list.map((n, i) => [n.id, i / Math.max(1, list.length - 1)]));
  const bary = (id: string, other: Map<string, number>, fallback: number) => {
    const ranks = (neighbours.get(id) ?? []).map((nb) => other.get(nb)).filter((r): r is number => r !== undefined);
    return ranks.length ? ranks.reduce((s, r) => s + r, 0) / ranks.length : fallback;
  };
  const sortGroup = <T extends { id: string; name: string }>(group: T[], other: Map<string, number>) => {
    const own = rank(group);
    return [...group].sort((a, b) => bary(a.id, other, own.get(a.id) ?? 0) - bary(b.id, other, own.get(b.id) ?? 0) || byName(a, b));
  };
  for (let round = 0; round < 3; round += 1) {
    const rightRank = rank(right);
    leftOrder = sortGroup(leftOrder, rightRank);
    const leftRank = rank(leftOrder);
    // the current idea stays between what is learnable now and what lies beyond
    right = [...sortGroup(learnable, leftRank), ...(current ? [current] : []), ...sortGroup(beyond, leftRank)];
  }

  const rowHeight = (state: FrontierState) => (state === 'current' ? CURRENT_ROW : ROW);
  const stackHeight = (list: { state: FrontierState }[]) => list.reduce((h, n) => h + rowHeight(n.state), 0);
  const height = Math.max(stackHeight(leftOrder), stackHeight(right), CURRENT_ROW) + 2 * PAD_Y;

  const placed: PlacedNode[] = [];
  const place = (list: typeof map.nodes, side: 'left' | 'right') => {
    let y = (height - stackHeight(list)) / 2;
    for (const n of list) {
      const row = rowHeight(n.state);
      const cy = y + row / 2;
      const r = DOT_RADIUS[n.state];
      const x = side === 'left' ? leftX : n.state === 'beyond' ? rightX + BEYOND_INDENT : rightX;
      const h = LABEL_HEIGHT[n.state];
      const label: LabelBox =
        side === 'left'
          ? { x: 0, y: cy - h / 2, width: Math.max(0, x - r - LABEL_GAP), height: h, align: 'right' }
          : { x: x + r + LABEL_GAP, y: cy - h / 2, width: Math.max(0, width - (x + r + LABEL_GAP)), height: h, align: 'left' };
      placed.push({ id: n.id, name: n.name, state: n.state, x, y: cy, label });
      y += row;
    }
  };
  place(leftOrder, 'left');
  place(right, 'right');

  const pos = new Map(placed.map((p) => [p.id, p]));
  const links = map.edges.flatMap(([a, b]) => {
    const p = pos.get(a);
    const q = pos.get(b);
    return p && q ? [{ from: a, to: b, path: linkPath(p, q, height) }] : [];
  });

  const cur = current ? pos.get(current.id) : undefined;
  return { width, height, nodes: placed, links, edgeLine: edgeLine(edgeX, height, cur ? [cur.x, cur.y] : null) };
}

/**
 * Links between the stacks are S-curves; links within a stack bow into the gap by the line,
 * away from the labels, more for longer spans so they clear the points in between.
 */
function linkPath(p: PlacedNode, q: PlacedNode, height: number): string {
  if (p.x !== q.x) {
    const mx = (p.x + q.x) / 2;
    return `M${p.x} ${p.y} C${mx} ${p.y} ${mx} ${q.y} ${q.x} ${q.y}`;
  }
  const span = Math.abs(p.y - q.y) / height;
  const direction = p.state === 'owned' ? 1 : -1;
  const bow = direction * Math.min(LEFT_OFFSET + 6, 8 + span * 40);
  return `M${p.x} ${p.y} C${p.x + bow} ${p.y} ${q.x + bow} ${q.y} ${q.x} ${q.y}`;
}

/** Straight down the gap, with a smooth detour through the current idea's point. */
function edgeLine(edgeX: number, height: number, current: Point | null): Cubic[] {
  const straight = (y0: number, y1: number): Cubic => [[edgeX, y0], [edgeX, y0], [edgeX, y1], [edgeX, y1]];
  if (!current) return [straight(0, height)];
  const [cx, cy] = current;
  const reach = 30;
  const top = Math.max(0, cy - reach);
  const bottom = Math.min(height, cy + reach);
  return [
    straight(0, top),
    [[edgeX, top], [edgeX, cy - 12], [cx, cy - 12], [cx, cy]],
    [[cx, cy], [cx, cy + 12], [edgeX, cy + 12], [edgeX, bottom]],
    straight(bottom, height),
  ];
}

export function cubicPath(segments: Cubic[]): string {
  return segments.map(([a, b, c, d], i) => `${i === 0 ? `M${a[0]} ${a[1]} ` : ''}C${b[0]} ${b[1]} ${c[0]} ${c[1]} ${d[0]} ${d[1]}`).join(' ');
}

export function pointOnCubic([a, b, c, d]: Cubic, t: number): Point {
  const u = 1 - t;
  const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
  return [k[0] * a[0] + k[1] * b[0] + k[2] * c[0] + k[3] * d[0], k[0] * a[1] + k[1] * b[1] + k[2] * c[1] + k[3] * d[1]];
}
