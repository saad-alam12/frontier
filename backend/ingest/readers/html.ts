import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { ReadResult, TextBlock } from '../types';

/** The slice of the DOM this reader uses; the backend compiles without the DOM lib. */
interface El {
  tagName: string;
  textContent: string | null;
  children: Iterable<El>;
  remove(): void;
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): Iterable<El>;
}
interface Doc extends El {
  body: El | null;
  documentElement: El;
}

function parse(html: string): Doc {
  return (parseHTML(html) as unknown as { document: Doc }).document;
}

/**
 * Main-content extraction (readability style) with headings as locators; falls back to visible text.
 * `article: false` reads the whole body, as for a book's chapter, where article extraction would cut parts.
 */
export function readHtml(html: string, fallbackTitle: string, options: { article?: boolean } = {}): ReadResult {
  const document = parse(html);
  let title = document.querySelector('title')?.textContent?.trim() || fallbackTitle;
  let root: El | null = null;
  if (options.article !== false) {
    try {
      const parsed = new Readability(document as unknown as Document).parse();
      if (parsed?.content) {
        if (parsed.title?.trim()) title = parsed.title.trim();
        root = parse(`<html><body>${parsed.content}</body></html>`).body;
      }
    } catch {
      root = null;
    }
  }
  if (!root) {
    for (const el of document.querySelectorAll('script, style, nav, footer, header, noscript')) el.remove();
    root = document.body ?? document.documentElement;
  }
  const blocks: TextBlock[] = [];
  let heading = 'start';
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join('\n\n').trim();
    if (text) blocks.push({ text, locator: heading });
    buffer = [];
  };
  const walk = (el: El) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        flush();
        heading = child.textContent?.replace(/\s+/g, ' ').trim() || heading;
        buffer.push(heading);
      } else if (['p', 'li', 'pre', 'blockquote', 'td', 'th', 'figcaption'].includes(tag)) {
        const text = child.textContent?.replace(/\s+/g, ' ').trim();
        if (text) buffer.push(text);
      } else {
        walk(child);
      }
    }
  };
  walk(root);
  flush();
  if (blocks.length === 0) {
    const text = root.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (text) blocks.push({ text, locator: 'start' });
  }
  return { title, blocks };
}
