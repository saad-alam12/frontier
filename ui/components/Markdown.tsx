import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

/** Links open in the system browser (the main process sends a new window there); the app's window never leaves the app. */
const LINKS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
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
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={inline ? INLINE : LINKS}>
        {text}
      </ReactMarkdown>
    </Tag>
  );
}
