import { describe, expect, it } from 'vitest';
import { buildTermIndex } from '../../backend/core/terms';
import { rehypeTerms } from './termsPlugin';

const index = buildTermIndex([
  { id: 'sum', names: ['Sum'] },
  { id: 'even', names: ['Even number'] },
]);

const text = (value: string) => ({ type: 'text', value });
const el = (tagName: string, children: unknown[], properties: Record<string, unknown> = {}) => ({ type: 'element', tagName, properties, children });
const run = (children: unknown[], exclude: string[] = []) => {
  const tree = { type: 'root', children } as Parameters<ReturnType<typeof rehypeTerms>>[0];
  rehypeTerms({ index, exclude: new Set(exclude) })(tree);
  return tree;
};
/** The ids wrapped anywhere in a tree, in order. */
function wrapped(node: unknown): string[] {
  const n = node as { type: string; properties?: { dataTerm?: string; className?: string[] }; children?: unknown[] };
  const own = n.type === 'element' && n.properties?.className?.includes('term-ref') ? [n.properties.dataTerm as string] : [];
  return [...own, ...(n.children ?? []).flatMap(wrapped)];
}

describe('hover definitions: the text plugin (R8 E2)', () => {
  it('wraps names in running text and keeps the text around them', () => {
    const tree = run([el('p', [text('The sum of two even numbers is even.')])]);
    expect(wrapped(tree)).toEqual(['sum', 'even']);
    const p = tree.children[0] as { children: { type: string; value?: string }[] };
    expect(p.children.map((c) => (c.type === 'text' ? c.value : '[term]'))).toEqual(['The ', '[term]', ' of two ', '[term]', ' is even.']);
  });

  it('leaves code, links, headings and formulas alone', () => {
    const tree = run([
      el('h2', [text('The sum')]),
      el('p', [el('code', [text('sum([1, 2])')]), text(' '), el('a', [text('the sum')], { href: 'https://example.org' })]),
      el('span', [el('span', [text('sum')], { className: ['mord'] })], { className: ['katex'] }),
      el('pre', [el('code', [text('even number')])]),
    ]);
    expect(wrapped(tree)).toEqual([]);
  });

  it('never wraps what the open question asks about', () => {
    expect(wrapped(run([el('p', [text('Is the sum of two even numbers even?')])], ['even']))).toEqual(['sum']);
  });
});
