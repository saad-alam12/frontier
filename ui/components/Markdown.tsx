import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Figure } from './Figure';

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

/**
 * Markdown with GitHub tables/lists and LaTeX math (KaTeX). Every statement, question and explanation
 * in the app goes through this, so no raw `$` ever shows. `inline` renders a single paragraph in a line.
 */
export function Markdown({ text, className = '', inline }: { text: string; className?: string; inline?: boolean }) {
  const Tag = inline ? 'span' : 'div';
  return (
    <Tag className={`markdown${inline ? ' is-inline' : ''} ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={inline ? INLINE : LINKS} urlTransform={urlTransform}>
        {text}
      </ReactMarkdown>
    </Tag>
  );
}
