const LABEL_GAP = 15;

/**
 * End labels pushed apart so lines that end together keep readable labels, and kept between `top`
 * and `bottom`: a stack that would run past the bottom (lines ending at zero) moves up as a whole.
 * Lines that end at the same value keep the order they were given in.
 */
export function labelPositions(ys: number[], top = -Infinity, bottom = Infinity): number[] {
  const order = ys.map((y, i) => ({ y: Math.max(top, Math.min(bottom, y)), i })).sort((a, b) => a.y - b.y || a.i - b.i);
  for (let j = 1; j < order.length; j += 1) {
    const prev = order[j - 1] as { y: number };
    const cur = order[j] as { y: number };
    if (cur.y - prev.y < LABEL_GAP) cur.y = prev.y + LABEL_GAP;
  }
  const last = order[order.length - 1];
  if (last && last.y > bottom) {
    last.y = bottom;
    for (let j = order.length - 2; j >= 0; j -= 1) {
      const next = order[j + 1] as { y: number };
      const cur = order[j] as { y: number };
      if (next.y - cur.y < LABEL_GAP) cur.y = next.y - LABEL_GAP;
    }
  }
  const out = new Array<number>(ys.length);
  for (const o of order) out[o.i] = o.y;
  return out;
}
