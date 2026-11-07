/**
 * The command palette's ranking: one search box for places, goals, ideas and actions. Pure, so the
 * order is tested; the palette component only renders it.
 */
export type PaletteGroup = 'Actions' | 'Places' | 'Goals' | 'Ideas';

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  /** A short second line: where it leads or what it does. */
  hint?: string;
  /** Other words it answers to ("flashcards" for Cards). */
  keywords?: string[];
}

/** Groups in the order they show when their best matches tie, and with an empty query. */
const GROUP_ORDER: PaletteGroup[] = ['Actions', 'Places', 'Goals', 'Ideas'];

const fold = (s: string) => s.toLowerCase().replace(/\$/g, '').normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** How well one text answers the query: 0 for no match, higher is better. */
export function matchScore(text: string, query: string): number {
  const t = fold(text);
  const q = fold(query).trim();
  if (!q) return 1;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  const words = t.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some((w) => w.startsWith(q))) return 60;
  // every query word starts some word of the text ("nash eq" → "Nash equilibrium")
  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => words.some((w) => w.startsWith(p)))) return 50;
  if (t.includes(q)) return 40;
  // the letters in order ("ndp" → "new deep plan"), only for short queries, as a last resort
  if (q.length <= 6) {
    let i = 0;
    for (const ch of t) if (ch === q[i]) i += 1;
    if (i === q.length) return 10;
  }
  return 0;
}

/** Items that match, best first; with no query, actions then places then goals, as given. */
export function rankItems(items: PaletteItem[], query: string, limit = 12): PaletteItem[] {
  const scored = items
    .map((item, index) => ({ item, index, score: Math.max(matchScore(item.label, query), ...(item.keywords ?? []).map((k) => Math.round(matchScore(k, query) * 0.7))) }))
    .filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || GROUP_ORDER.indexOf(a.item.group) - GROUP_ORDER.indexOf(b.item.group) || a.index - b.index);
  return scored.slice(0, limit).map((x) => x.item);
}
