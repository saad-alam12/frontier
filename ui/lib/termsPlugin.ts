/**
 * A rehype plugin for hover definitions (R8 E2): it reads the text of rendered Markdown and wraps each
 * name of a known idea in `<span class="term-ref" data-term="…">`, which `Markdown` turns into an
 * underlined word with its popover. It leaves alone what must stay exactly as written or would give
 * nothing: code, links, headings, formulas drawn by KaTeX, diagrams and plots, pictures.
 */
import { findTerms } from '../../backend/core/terms';
import type { TermIndex } from '../../backend/core/terms';

/** The parts of a hast tree this plugin reads and writes. */
interface Text {
  type: 'text';
  value: string;
}
interface Element {
  type: 'element';
  tagName: string;
  properties?: Record<string, unknown>;
  children: Node[];
}
interface Root {
  type: 'root';
  children: Node[];
}
type Node = Text | Element | Root | { type: string; children?: Node[] };

const SKIP_TAGS = new Set(['code', 'pre', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'svg', 'math', 'img', 'button', 'textarea', 'input']);

function classesOf(el: Element): string[] {
  const c = el.properties?.['className'];
  return Array.isArray(c) ? c.map(String) : typeof c === 'string' ? c.split(/\s+/) : [];
}

/** An element whose text is left as it is: code, a link, a heading, a formula, a drawing. */
function skipped(el: Element): boolean {
  return SKIP_TAGS.has(el.tagName) || classesOf(el).some((c) => c.startsWith('katex') || c === 'term-ref');
}

/** Split one text node into text and wrapped names. */
function wrapText(node: Text, index: TermIndex, exclude: ReadonlySet<string>): Node[] {
  const matches = findTerms(node.value, index, exclude);
  if (!matches.length) return [node];
  const out: Node[] = [];
  let at = 0;
  for (const m of matches) {
    if (m.start > at) out.push({ type: 'text', value: node.value.slice(at, m.start) });
    out.push({ type: 'element', tagName: 'span', properties: { className: ['term-ref'], dataTerm: m.id }, children: [{ type: 'text', value: node.value.slice(m.start, m.end) }] });
    at = m.end;
  }
  if (at < node.value.length) out.push({ type: 'text', value: node.value.slice(at) });
  return out;
}

function walk(parent: Root | Element, index: TermIndex, exclude: ReadonlySet<string>): void {
  const next: Node[] = [];
  for (const child of parent.children) {
    if (child.type === 'text') next.push(...wrapText(child as Text, index, exclude));
    else {
      if (child.type === 'element' && !skipped(child as Element)) walk(child as Element, index, exclude);
      next.push(child);
    }
  }
  parent.children = next;
}

/** The plugin, for `rehypePlugins`: run it after KaTeX, so formulas are already marked and left out. */
export function rehypeTerms(options: { index: TermIndex; exclude: ReadonlySet<string> }) {
  return (tree: Root): void => {
    if (options.index.size > 0) walk(tree, options.index, options.exclude);
  };
}
