import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

/**
 * Markdown with GitHub tables/lists and LaTeX math (KaTeX). Every statement, question and explanation
 * in the app goes through this, so no raw `$` ever shows. `inline` renders a single paragraph in a line.
 */
export function Markdown({ text, className = '', inline }: { text: string; className?: string; inline?: boolean }) {
  const Tag = inline ? 'span' : 'div';
  return (
    <Tag className={`markdown${inline ? ' is-inline' : ''} ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {text}
      </ReactMarkdown>
    </Tag>
  );
}
