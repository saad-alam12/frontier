/** How a flashcard's schedule reads in lists: new, due now, in 3 days, or suspended. */
import type { CardView } from '../../backend/api/contract';
import { formatInterval } from '../../backend/core/cards';

export function whenText(card: Pick<CardView, 'suspended' | 'phase' | 'due'>, now = new Date()): { text: string; due: boolean } {
  if (card.suspended) return { text: 'Suspended', due: false };
  if (card.phase === 'new' || !card.due) return { text: 'New', due: false };
  const ms = new Date(card.due).getTime() - now.getTime();
  return ms <= 0 ? { text: 'Due now', due: true } : { text: `In ${formatInterval(ms)}`, due: false };
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Card text keeps the line breaks it was written with: Markdown would join single lines into one
 * paragraph, and a card's lines (a formula, then one line per symbol) are meant as lines. Lines of a
 * display-math block are left alone.
 */
export function keepLineBreaks(text: string): string {
  const lines = text.split('\n');
  let inMath = false;
  return lines
    .map((line, i) => {
      const t = line.trim();
      const fence = t.startsWith('$$') && !(t.length > 2 && t.endsWith('$$'));
      if (fence) inMath = !inMath;
      const next = lines[i + 1]?.trim() ?? '';
      const breaks = !inMath && !fence && t !== '' && next !== '' && !next.startsWith('$$');
      return breaks ? `${line}  ` : line;
    })
    .join('\n');
}
