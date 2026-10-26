import type { Chunk, TextBlock } from './types';

/** Rough token estimate; the budget is a guide, not a contract. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const DEFAULT_CHUNK_TOKENS = 1500;
const MIN_CHUNK_TOKENS = 200;

/**
 * Pack blocks into chunks under a token budget without splitting a block unless it alone exceeds the
 * budget, in which case it is split at paragraph (then sentence) boundaries. Locators are kept as ranges.
 */
export function chunkBlocks(blocks: TextBlock[], budget = DEFAULT_CHUNK_TOKENS): Chunk[] {
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
    chunks.push({ text: current.map((b) => b.text).join('\n\n'), locator: rangeLocator(current) });
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
