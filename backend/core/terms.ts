/**
 * Hover definitions (R8 E2, design §8): finding, in a text, the words that name an idea the learner
 * has learned or keeps a flashcard on. Pure: the index is built from names, and the matcher reads
 * plain text runs (the caller leaves out code, links, headings and formulas).
 *
 * Matching is by whole words, case- and accent-insensitive, with simple plurals ("strategies" finds
 * "strategy"), the longest name first ("Nash equilibrium" before "equilibrium"). A name is ignored
 * when it would match too much: no word of three letters or more, or more than six words.
 */

export interface TermSource {
  /** The idea the name belongs to. */
  id: string;
  /** Its name and other names, as written (LaTeX allowed: only its words count). */
  names: string[];
}

/** One name of an idea, as the words it is matched by. */
interface Phrase {
  id: string;
  words: string[];
}

export interface TermIndex {
  /** Phrases by their first word, longest first. */
  byFirst: Map<string, Phrase[]>;
  /** How many phrases the index holds. */
  size: number;
}

export interface TermMatch {
  id: string;
  /** Offsets in the text: [start, end). */
  start: number;
  end: number;
}

/** Letters and digits of any alphabet, joined by an inner apostrophe or hyphen ("Nash's", "best-response"). */
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const MAX_WORDS = 6;

/** A word as it is compared: lower case, no accents, its simple plural made singular. */
export function wordKey(word: string): string {
  const plain = word
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]s$/, '');
  if (plain.length > 4 && plain.endsWith('ies')) return `${plain.slice(0, -3)}y`;
  if (plain.length > 4 && /(?:ss|x|z|ch|sh)es$/.test(plain)) return plain.slice(0, -2);
  if (plain.length > 3 && plain.endsWith('s') && !plain.endsWith('ss') && !plain.endsWith('us') && !plain.endsWith('is')) return plain.slice(0, -1);
  return plain;
}

/** The words of a name as it reads: LaTeX commands and symbols drop out ("$\\alpha$-level" reads "alpha level"). */
function nameWords(name: string): string[] {
  const readable = name.replace(/\\([a-zA-Z]+)/g, ' $1 ').replace(/[$^_{}]/g, ' ');
  return [...readable.matchAll(WORD)].map((m) => wordKey(m[0]));
}

/** Build the index once per map version; the matcher then reads any number of texts with it. */
export function buildTermIndex(sources: TermSource[]): TermIndex {
  const byFirst = new Map<string, Phrase[]>();
  const seen = new Set<string>();
  let size = 0;
  for (const source of sources) {
    for (const name of source.names) {
      const words = nameWords(name);
      if (words.length === 0 || words.length > MAX_WORDS || !words.some((w) => w.length >= 3)) continue;
      const key = `${source.id}|${words.join(' ')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const first = words[0] as string;
      const list = byFirst.get(first) ?? [];
      list.push({ id: source.id, words });
      byFirst.set(first, list);
      size += 1;
    }
  }
  for (const list of byFirst.values()) list.sort((a, b) => b.words.length - a.words.length);
  return { byFirst, size };
}

/**
 * The names found in a run of plain text, left to right, never overlapping: at each word the longest
 * name that starts there wins, and the match goes on after it. Ideas in `exclude` are never matched
 * (the idea a question asks about), and nor is a word inside a longer name of an excluded idea.
 */
export function findTerms(text: string, index: TermIndex, exclude: ReadonlySet<string> = new Set()): TermMatch[] {
  if (index.size === 0) return [];
  const words = [...text.matchAll(WORD)].map((m) => ({ key: wordKey(m[0]), start: m.index, end: m.index + m[0].length }));
  const found: TermMatch[] = [];
  let i = 0;
  while (i < words.length) {
    const candidates = index.byFirst.get((words[i] as { key: string }).key);
    const hit = candidates?.find((p) => p.words.every((w, k) => words[i + k]?.key === w));
    if (!hit) {
      i += 1;
      continue;
    }
    const last = words[i + hit.words.length - 1] as { end: number };
    if (!exclude.has(hit.id)) found.push({ id: hit.id, start: (words[i] as { start: number }).start, end: last.end });
    i += hit.words.length;
  }
  return found;
}
