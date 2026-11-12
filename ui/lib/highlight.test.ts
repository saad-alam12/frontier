import { describe, expect, it } from 'vitest';
import { highlightPython } from './highlight';

const kinds = (source: string) => highlightPython(source).filter((t) => t.kind !== 'plain').map((t) => [t.kind, t.text]);

describe('python colours', () => {
  it('colours keywords, built-ins, strings, comments, numbers and defined names', () => {
    expect(kinds('def mean(xs):  # average\n    return sum(xs) / len(xs) * 1.5')).toEqual([
      ['keyword', 'def'],
      ['definition', 'mean'],
      ['comment', '# average'],
      ['keyword', 'return'],
      ['builtin', 'sum'],
      ['builtin', 'len'],
      ['number', '1.5'],
    ]);
    expect(kinds('@cache\nclass Model: pass')).toEqual([
      ['decorator', '@cache'],
      ['keyword', 'class'],
      ['definition', 'Model'],
      ['keyword', 'pass'],
    ]);
  });

  it('reads strings whole, with escapes, prefixes and three quotes, and survives one left open', () => {
    expect(kinds('f"a {x} \\" b" + \'c\'')).toEqual([
      ['string', 'f"a {x} \\" b"'],
      ['string', "'c'"],
    ]);
    expect(kinds('"""doc\n# not a comment\n""" + 1')).toEqual([
      ['string', '"""doc\n# not a comment\n"""'],
      ['number', '1'],
    ]);
    expect(kinds('x = "open')).toEqual([['string', '"open']]);
    expect(kinds('s = """open\nand on')).toEqual([['string', '"""open\nand on']]);
  });

  it('gives back the source exactly, so the colours line up with the text', () => {
    const source = 'import numpy as np\nfor i in range(3):\n\tprint(i ** 2, "\\n")\n';
    expect(highlightPython(source).map((t) => t.text).join('')).toBe(source);
  });
});
