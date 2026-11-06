import { useEffect, useState } from 'react';
import { clearAnswerExtras, setQuote, useAnswerExtras } from './AnswerExtras';

interface Pill {
  text: string;
  top: number;
  left: number;
}

/**
 * Select text inside a message of the conversation (a card, an explanation, feedback, an earlier
 * answer) and a "Reply" pill appears just above it; clicking it puts the selection above the answer
 * box as a quote. It only appears while an answer box that takes quotes is open.
 */
export function QuoteReply({ containerRef }: { containerRef: React.RefObject<HTMLElement | null> }) {
  const { targets } = useAnswerExtras();
  const [pill, setPill] = useState<Pill | null>(null);

  useEffect(() => {
    const place = () => setPill(pillFor(containerRef.current));
    document.addEventListener('selectionchange', place);
    // the pill is fixed to the viewport, so it follows the selection when the column scrolls
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('selectionchange', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [containerRef]);

  // leaving the session screen drops unsent images and quotes, so another session never inherits them
  useEffect(() => clearAnswerExtras, []);

  if (!pill || targets === 0) return null;
  return (
    <button
      type="button"
      className="reply-pill"
      style={{ top: pill.top, left: pill.left }}
      // keep the selection alive until the click lands
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        setQuote(pill.text);
        document.getSelection()?.removeAllRanges();
        setPill(null);
      }}
    >
      <QuoteIcon />
      Reply
    </button>
  );
}

function pillFor(container: HTMLElement | null): Pill | null {
  const selection = document.getSelection();
  if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const element = node instanceof Element ? node : node.parentElement;
  if (!element || !container.contains(element)) return null;
  // the answer being written is not a message, and neither are controls
  if (element.closest('.answer-surface, textarea, input, button')) return null;
  const message = element.closest('article, section');
  if (!message || !container.contains(message)) return null;
  const text = selectedText(range) || selection.toString().trim();
  if (!text) return null;
  const rect = range.getBoundingClientRect();
  return { text, top: rect.top, left: rect.left + rect.width / 2 };
}

/**
 * The selection as text the tutor can read: rendered math is replaced by its TeX source, because
 * KaTeX's visible glyphs and hidden MathML would otherwise both end up in the quote.
 */
function selectedText(range: Range): string {
  const fragment = range.cloneContents();
  for (const math of Array.from(fragment.querySelectorAll('.katex'))) {
    const tex = math.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    math.replaceWith(tex ? `$${tex}$` : '');
  }
  // a selection that starts inside a formula clones only part of it, without the TeX source
  for (const part of Array.from(fragment.querySelectorAll('.katex-html, .katex-mathml'))) part.remove();
  return (fragment.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function QuoteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 8.5c0-2.6 1.2-4.4 3.4-5.3M8 8.5c0-2.6 1.2-4.4 3.4-5.3M2 8.5h3v3H2zM8 8.5h3v3H8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
