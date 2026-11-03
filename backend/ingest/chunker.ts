import type { Chunk, TextBlock } from './types';

/** Rough token estimate; the budget is a guide, not a contract. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * A source is read in as few parts as possible, so the extractor sees a whole paper or lecture at once
 * and can decide which ideas are central. Only book-length sources are split (about 80 pages each).
 */
export const PART_TOKENS = 40_000;
const MIN_CHUNK_TOKENS = 200;

/**
 * Slide PDFs often export every animation build as its own page, each repeating the one before plus a
 * little more. Collapse consecutive pages whose text is contained in the next page's text: keep the
 * last (fullest) page and give it the whole page range, so citations still point at real pages.
 */
export function collapseBuildPages(blocks: TextBlock[]): TextBlock[] {
  const out: TextBlock[] = [];
  let runStart: string | null = null;
  blocks.forEach((block, i) => {
    const next = blocks[i + 1];
    const text = normalize(block.text);
    if (next && text && normalize(next.text).includes(text)) {
      runStart ??= block.locator;
      return;
    }
    out.push(runStart ? { text: block.text, locator: joinLocators(runStart, block.locator) } : block);
    runStart = null;
  });
  return out;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Pack blocks into chunks under a token budget without splitting a block unless it alone exceeds the
 * budget, in which case it is split at paragraph (then sentence) boundaries. Locators are kept as ranges,
 * and each block starts with its own locator in brackets (`[p12]`) so ideas can cite their page.
 */
export function chunkBlocks(blocks: TextBlock[], budget = PART_TOKENS): Chunk[] {
  const pieces: TextBlock[] = [];
  for (const block of blocks) {
    if (estimateTokens(block.text) <= budget) pieces.push(block);
    else for (const part of splitLarge(block.text, budget)) pieces.push({ text: part, locator: block.locator });
  }

  const chunks: Chunk[] = [];
  let current: TextBlock[] = [];
  let tokens = 0;
  const flush = () => {
    if (current.length === 0) return;
    chunks.push({ text: current.map((b, i) => (i > 0 && current[i - 1]?.locator === b.locator ? b.text : `[${b.locator}]\n${b.text}`)).join('\n\n'), locator: rangeLocator(current) });
    current = [];
    tokens = 0;
  };
  for (const piece of pieces) {
    const t = estimateTokens(piece.text);
    if (tokens + t > budget && tokens > 0) flush();
    current.push(piece);
    tokens += t;
  }
  flush();

  // Fold a tiny trailing chunk into the previous one so no chunk is just a heading or a footer.
  const last = chunks[chunks.length - 1];
  const prev = chunks[chunks.length - 2];
  if (last && prev && estimateTokens(last.text) < MIN_CHUNK_TOKENS && estimateTokens(prev.text) + estimateTokens(last.text) <= budget * 1.2) {
    chunks.splice(chunks.length - 2, 2, { text: `${prev.text}\n\n${last.text}`, locator: joinLocators(prev.locator, last.locator) });
  }
  return chunks;
}

/**
 * The blocks back from stored parts, for reading a source again when there is no file to read (a
 * session transcript): each `[locator]` line starts a block; a part without markers is one block.
 */
export function blocksFromParts(parts: Chunk[]): TextBlock[] {
  return parts.flatMap((part) => {
    const pieces = part.text.split(/^\[([^\]\n]+)\]\n/m);
    if (pieces.length === 1) return [{ text: part.text, locator: part.locator }];
    const blocks: TextBlock[] = [];
    if (pieces[0]?.trim()) blocks.push({ text: pieces[0].trim(), locator: part.locator });
    for (let i = 1; i < pieces.length; i += 2) blocks.push({ text: (pieces[i + 1] ?? '').trim(), locator: pieces[i] as string });
    return blocks.filter((b) => b.text);
  });
}

function splitLarge(text: string, budget: number): string[] {
  const out: string[] = [];
  let current = '';
  const paragraphs = text.split(/\n\s*\n/);
  const push = (p: string) => {
    if (estimateTokens(current) + estimateTokens(p) > budget && current) {
      out.push(current.trim());
      current = '';
    }
    current += (current ? '\n\n' : '') + p;
  };
  for (const p of paragraphs) {
    if (estimateTokens(p) <= budget) push(p);
    else {
      for (const sentence of p.split(/(?<=[.!?])\s+/)) {
        if (estimateTokens(sentence) > budget) {
          for (let i = 0; i < sentence.length; i += budget * 4) push(sentence.slice(i, i + budget * 4));
        } else push(sentence);
      }
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function rangeLocator(blocks: TextBlock[]): string {
  const first = blocks[0]?.locator ?? '';
  const last = blocks[blocks.length - 1]?.locator ?? '';
  return joinLocators(first, last);
}

function joinLocators(a: string, b: string): string {
  if (a === b) return a;
  const aEnd = a.split('–').pop() ?? a;
  const bEnd = b.split('–').pop() ?? b;
  const aStart = a.split('–')[0] ?? a;
  if (aEnd === bEnd) return a;
  return `${aStart}–${bEnd}`;
}
