import { describe, expect, it } from 'vitest';
import { evaluate, niceTicks, parseExpression, plotBlocks, plotIssues, readPlot, samplePlot, tickLabel } from './plot';

const at = (text: string, x: number) => evaluate(parseExpression(text), x);

describe('formulas in x', () => {
  it('follows the usual order of operations', () => {
    expect(at('1 + 2 * x', 3)).toBe(7);
    expect(at('(1 + 2) * x', 3)).toBe(9);
    expect(at('10 - 2*x - 1', 2)).toBe(5);
    expect(at('x / 2 / 2', 8)).toBe(2);
    expect(at('2^3^2', 0)).toBe(512);
    expect(at('-x^2', 3)).toBe(-9);
    expect(at('x**2', 3)).toBe(9);
    expect(at('2 * -x', 3)).toBe(-6);
  });

  it('multiplies a number or a bracket written next to x or a bracket', () => {
    expect(at('2x', 4)).toBe(8);
    expect(at('3(x+1)', 1)).toBe(6);
    expect(at('(x+1)(x-1)', 3)).toBe(8);
    expect(at('2x^2', 3)).toBe(18);
  });

  it('knows the common functions and constants', () => {
    expect(at('sin(pi/2)', 0)).toBeCloseTo(1);
    expect(at('ln(e)', 0)).toBeCloseTo(1);
    expect(at('log(1000)', 0)).toBeCloseTo(3);
    expect(at('sqrt(x) + abs(-2)', 9)).toBe(5);
    expect(at('max(x, 2)', 1)).toBe(2);
    expect(at('1.5e2 + .5', 0)).toBe(150.5);
  });

  it('is undefined where the formula is', () => {
    expect(at('1/x', 0)).toBe(Infinity);
    expect(Number.isNaN(at('sqrt(x)', -1))).toBe(true);
  });

  it('refuses anything that is not a formula in x, with a plain reason', () => {
    expect(() => parseExpression('y + 1')).toThrow(/only variable is x/);
    expect(() => parseExpression('x +')).toThrow(/ends too early/);
    expect(() => parseExpression('(x + 1')).toThrow(/expected "\)"/);
    expect(() => parseExpression('max(x)')).toThrow(/takes 2 values/);
    expect(() => parseExpression('x; process.exit()')).toThrow(/not allowed/);
    expect(() => parseExpression('')).toThrow(/empty/);
  });
});

describe('plot blocks', () => {
  const block = (json: string) => `Here is the picture:\n\n\`\`\`plot\n${json}\n\`\`\`\n\nThe curves cross at the price.`;

  it('finds the fenced plot blocks of a text', () => {
    expect(plotBlocks(block('{"a":1}'))).toEqual(['{"a":1}']);
    expect(plotBlocks('```python\nprint(1)\n```')).toEqual([]);
  });

  it('reads a valid spec and explains an invalid one', () => {
    const good = readPlot('{"x":{"min":0,"max":10,"label":"quantity"},"curves":[{"label":"demand","y":"10 - x"},{"label":"supply","y":"x"}],"points":[{"x":5,"y":5,"label":"equilibrium"}]}');
    expect(good.ok).toBe(true);
    expect(readPlot('{x: 1}')).toEqual({ ok: false, error: 'it is not valid JSON' });
    const bad = readPlot('{"x":{"min":5,"max":1},"curves":[{"y":"2*q"}]}');
    expect(bad.ok).toBe(false);
    expect(bad.ok ? '' : bad.error).toMatch(/x.max must be greater/);
    expect(bad.ok ? '' : bad.error).toMatch(/curves.0.y: cannot read "2\*q"/);
    expect(readPlot('{"x":{"min":0,"max":1}}').ok).toBe(false);
  });

  it('lists the problems of every plot block anywhere in a card', () => {
    const card = { stage: 'explain', markdown: block('{"x":{"min":0,"max":1},"curves":[{"y":"x+"}]}'), extra: [block('not json')] };
    const issues = plotIssues(card);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatch(/^a plot block cannot be drawn: curves.0.y/);
    expect(plotIssues({ markdown: block('{"x":{"min":0,"max":1},"curves":[{"y":"x"}]}') })).toEqual([]);
  });
});

describe('sampling a plot', () => {
  it('samples curves over x and fits y to the data, from zero when the data starts near it', () => {
    const read = readPlot('{"x":{"min":0,"max":10},"curves":[{"label":"demand","y":"10 - x"}]}');
    if (!read.ok) throw new Error(read.error);
    const plot = samplePlot(read.spec, 10);
    expect(plot.lines[0]?.points).toHaveLength(11);
    expect(plot.lines[0]?.points[0]).toEqual([0, 10]);
    expect(plot.y.min).toBe(0);
    expect(plot.y.max).toBeGreaterThan(10);
    expect(plot.x.ticks).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it('breaks a line where the formula is undefined or leaves the chart', () => {
    const read = readPlot('{"x":{"min":-1,"max":1},"y":{"min":-5,"max":5},"curves":[{"y":"1/x"}]}');
    if (!read.ok) throw new Error(read.error);
    const plot = samplePlot(read.spec, 200);
    const points = plot.lines[0]?.points ?? [];
    expect(points.some((p) => p === null)).toBe(true);
    expect(points.filter((p): p is [number, number] => p !== null).every(([, y]) => Math.abs(y) <= 5.2)).toBe(true);
  });

  it('keeps marked points and series inside the chart', () => {
    const read = readPlot('{"x":{"min":0,"max":4},"series":[{"label":"data","points":[[0,1],[2,3],[6,9]]}],"points":[{"x":2,"y":3,"label":"here"},{"x":9,"y":1}]}');
    if (!read.ok) throw new Error(read.error);
    const plot = samplePlot(read.spec);
    expect(plot.lines[0]?.points).toEqual([[0, 1], [2, 3], null]);
    expect(plot.points).toEqual([{ x: 2, y: 3, label: 'here' }]);
  });
});

describe('ticks', () => {
  it('chooses round steps', () => {
    expect(niceTicks(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(-3, 7)).toEqual([-2, 0, 2, 4, 6]);
    expect(niceTicks(0, 1000)).toEqual([0, 200, 400, 600, 800, 1000]);
  });
  it('labels them briefly', () => {
    expect(tickLabel(0.30000000000000004)).toBe('0.3');
    expect(tickLabel(25000)).toBe('25k');
    expect(tickLabel(-2)).toBe('-2');
  });
});
