/**
 * Plots in explanations (design §4.2, "Diagrams and plots"): the tutor writes a fenced `plot` block
 * holding a small JSON spec (curves as formulas in x, data series, marked points), and the window draws
 * it. Pure: the spec and its formulas are checked here before a card is accepted, and sampled here for
 * drawing, so the picture never depends on the model doing arithmetic.
 */
import { z } from 'zod';

// ---------- formulas in x ----------

export type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'x' }
  | { kind: 'neg'; arg: Expr }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: Expr; right: Expr }
  | { kind: 'call'; fn: FnName; args: Expr[] };

const FNS = {
  sin: [1, Math.sin],
  cos: [1, Math.cos],
  tan: [1, Math.tan],
  exp: [1, Math.exp],
  ln: [1, Math.log],
  log: [1, Math.log10],
  log2: [1, Math.log2],
  sqrt: [1, Math.sqrt],
  abs: [1, Math.abs],
  floor: [1, Math.floor],
  ceil: [1, Math.ceil],
  min: [2, Math.min],
  max: [2, Math.max],
} as const satisfies Record<string, readonly [number, (...a: number[]) => number]>;
type FnName = keyof typeof FNS;
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Token = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (/\s/.test(c)) {
      i += 1;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(i));
      if (!m) throw new Error(`cannot read the number at "${text.slice(i, i + 8)}"`);
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (/[a-zA-Z]/.test(c)) {
      const m = /^[a-zA-Z][a-zA-Z0-9]*/.exec(text.slice(i)) as RegExpExecArray;
      out.push({ t: 'id', v: m[0].toLowerCase() });
      i += m[0].length;
    } else if ('+-*/^(),'.includes(c)) {
      // ** is a power, as in Python
      if (c === '*' && text[i + 1] === '*') {
        out.push({ t: 'op', v: '^' });
        i += 2;
      } else {
        out.push({ t: 'op', v: c });
        i += 1;
      }
    } else {
      throw new Error(`"${c}" is not allowed in a formula`);
    }
  }
  return out;
}

/**
 * Read a formula in x: numbers, x, + - * / ^ (or **), brackets, pi and e, and sin cos tan exp ln log
 * log2 sqrt abs floor ceil min max. A number or a bracket next to x or a bracket multiplies (2x, 3(x+1)).
 * Throws with a plain message on anything else.
 */
export function parseExpression(text: string): Expr {
  const tokens = tokenize(text);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.t === 'op' && peek()?.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`expected "${v}"`);
    pos += 1;
  };

  const sum = (): Expr => {
    let left = product();
    while (isOp('+') || isOp('-')) {
      const op = (tokens[pos++] as Token).v as '+' | '-';
      left = { kind: 'bin', op, left, right: product() };
    }
    return left;
  };
  // a factor that starts right after another without an operator multiplies it (2x, 2(x+1), (x+1)(x-1))
  const startsFactor = () => {
    const next = peek();
    return next !== undefined && (next.t === 'id' || next.t === 'num' || (next.t === 'op' && next.v === '('));
  };
  const product = (): Expr => {
    let left = unary();
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = (tokens[pos++] as Token).v as '*' | '/';
        left = { kind: 'bin', op, left, right: unary() };
      } else if (startsFactor()) {
        left = { kind: 'bin', op: '*', left, right: power() };
      } else {
        return left;
      }
    }
  };
  const unary = (): Expr => {
    if (isOp('-')) {
      pos += 1;
      return { kind: 'neg', arg: unary() };
    }
    if (isOp('+')) {
      pos += 1;
      return unary();
    }
    return power();
  };
  // ^ binds tighter than a leading minus (-x^2 is -(x^2)) and groups to the right (2^3^2 is 2^9)
  const power = (): Expr => {
    const base = primary();
    if (isOp('^')) {
      pos += 1;
      return { kind: 'bin', op: '^', left: base, right: unary() };
    }
    return base;
  };
  const primary = (): Expr => {
    const token = peek();
    if (!token) throw new Error('the formula ends too early');
    pos += 1;
    if (token.t === 'num') return { kind: 'num', value: token.v };
    if (token.t === 'op') {
      if (token.v !== '(') throw new Error(`unexpected "${token.v}"`);
      const inner = sum();
      expect(')');
      return inner;
    }
    if (token.v === 'x') return { kind: 'x' };
    const constant = CONSTANTS[token.v];
    if (constant !== undefined) return { kind: 'num', value: constant };
    if (token.v in FNS) {
      const fn = token.v as FnName;
      const [arity] = FNS[fn];
      expect('(');
      const args = [sum()];
      while (isOp(',')) {
        pos += 1;
        args.push(sum());
      }
      expect(')');
      if (args.length !== arity) throw new Error(`${fn} takes ${arity === 1 ? 'one value' : `${arity} values`}`);
      return { kind: 'call', fn, args };
    }
    throw new Error(`"${token.v}" is not known: the only variable is x`);
  };

  if (tokens.length === 0) throw new Error('the formula is empty');
  const expr = sum();
  if (pos < tokens.length) throw new Error(`unexpected "${(tokens[pos] as Token).v}"`);
  return expr;
}

/** The formula's value at x; NaN or ±Infinity where it is not defined. */
export function evaluate(expr: Expr, x: number): number {
  switch (expr.kind) {
    case 'num':
      return expr.value;
    case 'x':
      return x;
    case 'neg':
      return -evaluate(expr.arg, x);
    case 'call': {
      const fn = FNS[expr.fn][1] as (...a: number[]) => number;
      return fn(...expr.args.map((a) => evaluate(a, x)));
    }
    case 'bin': {
      const a = evaluate(expr.left, x);
      const b = evaluate(expr.right, x);
      if (expr.op === '+') return a + b;
      if (expr.op === '-') return a - b;
      if (expr.op === '*') return a * b;
      if (expr.op === '/') return a / b;
      return a ** b;
    }
  }
}

// ---------- the spec ----------

const Label = z.string().trim().min(1).max(60);
const Finite = z.number().finite();

export const PlotSpecSchema = z
  .object({
    title: z.string().trim().max(100).optional(),
    x: z.object({ label: Label.optional(), min: Finite, max: Finite }),
    y: z.object({ label: Label.optional(), min: Finite.optional(), max: Finite.optional() }).optional(),
    curves: z.array(z.object({ label: Label.optional(), y: z.string().trim().min(1).max(200) })).max(4).optional(),
    series: z.array(z.object({ label: Label.optional(), points: z.array(z.tuple([Finite, Finite])).min(2).max(200) })).max(4).optional(),
    points: z.array(z.object({ x: Finite, y: Finite, label: Label.optional() })).max(12).optional(),
  })
  .superRefine((spec, ctx) => {
    if (!(spec.x.max > spec.x.min)) ctx.addIssue({ code: 'custom', path: ['x'], message: 'x.max must be greater than x.min' });
    if (spec.y?.min !== undefined && spec.y.max !== undefined && !(spec.y.max > spec.y.min)) ctx.addIssue({ code: 'custom', path: ['y'], message: 'y.max must be greater than y.min' });
    if (!spec.curves?.length && !spec.series?.length && !spec.points?.length) ctx.addIssue({ code: 'custom', path: [], message: 'give at least one curve, series or point' });
    spec.curves?.forEach((curve, i) => {
      try {
        parseExpression(curve.y);
      } catch (error) {
        ctx.addIssue({ code: 'custom', path: ['curves', i, 'y'], message: `cannot read "${curve.y}": ${(error as Error).message}` });
      }
    });
  });
export type PlotSpec = z.infer<typeof PlotSpecSchema>;

const FENCE = /^```plot[ \t]*\n([\s\S]*?)\n```[ \t]*$/gm;

/** The bodies of the fenced `plot` blocks in a text, in order. */
export function plotBlocks(markdown: string): string[] {
  return [...markdown.matchAll(FENCE)].map((m) => m[1] as string);
}

/** A plot block read into its spec, or why it cannot be. */
export function readPlot(body: string): { ok: true; spec: PlotSpec } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, error: 'it is not valid JSON' };
  }
  const parsed = PlotSpecSchema.safeParse(json);
  if (parsed.success) return { ok: true, spec: parsed.data };
  return { ok: false, error: parsed.error.issues.map((i) => `${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}`).join('; ') };
}

/** What is wrong with each plot block in any string of a value (a card, an answer), for the model to fix. */
export function plotIssues(value: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown) => {
    if (typeof v === 'string') {
      plotBlocks(v).forEach((body) => {
        const read = readPlot(body);
        if (!read.ok) out.push(`a plot block cannot be drawn: ${read.error}`);
      });
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') Object.values(v).forEach(visit);
  };
  visit(value);
  return out;
}

// ---------- drawing ----------

/** A line to draw: points in data units, null where it breaks (undefined, or off the chart). */
export interface PlotLine {
  label: string | null;
  points: ([number, number] | null)[];
}

export interface SampledPlot {
  x: { min: number; max: number; label: string | null; ticks: number[] };
  y: { min: number; max: number; label: string | null; ticks: number[] };
  lines: PlotLine[];
  points: { x: number; y: number; label: string | null }[];
  title: string | null;
}

const SAMPLES = 240;

/** Sample the curves and fit the axes: the y range is the one given, or what the data spans with a margin. */
export function samplePlot(spec: PlotSpec, samples = SAMPLES): SampledPlot {
  const { min: x0, max: x1 } = spec.x;
  const curves = (spec.curves ?? []).map((curve) => {
    const expr = parseExpression(curve.y);
    const pts: [number, number][] = [];
    for (let i = 0; i <= samples; i += 1) {
      const x = x0 + ((x1 - x0) * i) / samples;
      pts.push([x, evaluate(expr, x)]);
    }
    return { label: curve.label ?? null, pts };
  });
  const series = (spec.series ?? []).map((s) => ({ label: s.label ?? null, pts: s.points.map(([x, y]) => [x, y] as [number, number]) }));
  const marked = (spec.points ?? []).map((p) => ({ x: p.x, y: p.y, label: p.label ?? null }));

  const ys = [...curves.flatMap((c) => c.pts.map((p) => p[1])), ...series.flatMap((s) => s.pts.map((p) => p[1])), ...marked.map((p) => p.y)].filter(Number.isFinite);
  const [autoMin, autoMax] = yRange(ys);
  let yMin = spec.y?.min ?? autoMin;
  let yMax = spec.y?.max ?? autoMax;
  if (!(yMax > yMin)) [yMin, yMax] = yMin === yMax ? [yMin - 1, yMax + 1] : [yMax, yMin];

  const inside = (y: number) => Number.isFinite(y) && y >= yMin - (yMax - yMin) * 0.02 && y <= yMax + (yMax - yMin) * 0.02;
  const lines: PlotLine[] = [
    ...curves.map((c) => ({ label: c.label, points: c.pts.map((p) => (inside(p[1]) ? p : null)) })),
    ...series.map((s) => ({ label: s.label, points: s.pts.map((p) => (inside(p[1]) && p[0] >= x0 && p[0] <= x1 ? p : null)) })),
  ];
  return {
    x: { min: x0, max: x1, label: spec.x.label ?? null, ticks: niceTicks(x0, x1) },
    y: { min: yMin, max: yMax, label: spec.y?.label ?? null, ticks: niceTicks(yMin, yMax) },
    lines,
    points: marked.filter((p) => p.x >= x0 && p.x <= x1 && p.y >= yMin && p.y <= yMax),
    title: spec.title ?? null,
  };
}

/**
 * The y range of the data with a margin. A curve that shoots off (1/x near 0, tan) would flatten the
 * rest, so the extreme 2% at each end is left out of the range when there are many values.
 */
function yRange(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  const sorted = [...values].sort((a, b) => a - b);
  const cut = sorted.length >= 50 ? Math.floor(sorted.length * 0.02) : 0;
  const lo = sorted[cut] as number;
  const hi = sorted[sorted.length - 1 - cut] as number;
  if (lo === hi) return [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.08;
  // a range that starts near zero starts at zero, as a reader expects
  const min = lo >= 0 && lo - pad < (hi - lo) * 0.25 ? 0 : lo - pad;
  return [min, hi + pad];
}

/** Round tick values (1, 2 or 5 times a power of ten) covering [min, max], about `count` of them. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const rough = (max - min) / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power) as number;
  const out: number[] = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)) === 0 ? 0 : Number(v.toPrecision(12)));
  return out;
}

/** A tick value as a short label: no trailing zeros, thousands as k when large. */
export function tickLabel(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10_000) return `${Number((value / 1000).toPrecision(3))}k`;
  if (abs !== 0 && abs < 0.001) return value.toExponential(0);
  return String(Number(value.toPrecision(4)));
}
