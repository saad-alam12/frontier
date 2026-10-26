import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

/** Markdown with GitHub tables/lists and LaTeX math (KaTeX). */
export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`prose-frontier text-[15px] ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
