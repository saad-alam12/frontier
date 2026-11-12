import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Figure } from './Figure';
import { Diagram, DrawingPending } from './Diagram';
import { Plot } from './Plot';

const FIGURE = /^figure:([a-z0-9_]+)$/;

/** Addresses as react-markdown keeps them, plus `figure:` for pictures of pages the tutor shows. */
const urlTransform = (url: string) => (FIGURE.test(url) ? url : defaultUrlTransform(url));

/**
 * Links open in the system browser (the main process sends a new window there); the app's window never
 * leaves the app. An image is drawn only when it is a figure from the learner's material; any other
 * address shows its description, since the window loads no pictures from outside.
 */
const LINKS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  img: ({ src, alt }) => {
    const id = typeof src === 'string' ? FIGURE.exec(src)?.[1] : undefined;
    return id ? <Figure figureId={id} caption={alt ?? ''} /> : <span className="image-alt">{alt}</span>;
  },
};
/** Inline use renders paragraphs as plain runs of text, so a name can sit inside a sentence or a button. */
const INLINE: Components = { ...LINKS, p: ({ children }) => <>{children}</> };

/** The language and text of a fenced block, when `node` is the `pre` around one. */
function fenced(node: unknown): { language: string; text: string } | null {
  const code = (node as { children?: { tagName?: string; properties?: { className?: unknown }; children?: { value?: string }[] }[] } | undefined)?.children?.[0];
  if (code?.tagName !== 'code') return null;
  const classes = Array.isArray(code.properties?.className) ? (code.properties.className as string[]) : [];
  const language = classes.find((c) => c.startsWith('language-'))?.slice('language-'.length) ?? '';
  return { language, text: (code.children ?? []).map((c) => c.value ?? '').join('').replace(/\n$/, '') };
}

/** Fenced `mermaid` and `plot` blocks are drawn (design §4.2, "Diagrams and plots"); other code stays code. */
const drawings = (drafting: boolean): Components => ({
  pre: ({ node, children }) => {
    const block = fenced(node);
    if (block?.language === 'mermaid') return drafting ? <DrawingPending what="diagram" /> : <Diagram source={block.text} />;
    if (block?.language === 'plot') return drafting ? <DrawingPending what="plot" /> : <Plot source={block.text} />;
    return <pre>{children}</pre>;
  },
});
const BLOCKS: Components = { ...LINKS, ...drawings(false) };
const DRAFTING: Components = { ...LINKS, ...drawings(true) };

/**
 * Markdown with GitHub tables/lists, LaTeX math (KaTeX), diagrams and plots. Every statement, question
 * and explanation in the app goes through this, so no raw `$` ever shows. `inline` renders a single
 * paragraph in a line.
 */
export function Markdown({ text, className = '', inline, drafting }: { text: string; className?: string; inline?: boolean; /** The text is still being written: drawings wait until it is done. */ drafting?: boolean }) {
  const Tag = inline ? 'span' : 'div';
  return (
    <Tag className={`markdown${inline ? ' is-inline' : ''} ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={inline ? INLINE : drafting ? DRAFTING : BLOCKS} urlTransform={urlTransform}>
        {text}
      </ReactMarkdown>
    </Tag>
  );
}
