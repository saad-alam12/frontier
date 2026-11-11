/**
 * The passage of a source that teaches an idea. A source is read whole (a paper is one part of up to
 * 40,000 tokens), so "the text of the part that covers the idea" is the whole paper; the tutor needs
 * the page the idea cites. Each page, slide or heading starts with its marker in brackets (`[p12]`).
 */

const MARKER = /^\[([^\]\n]+)\]\n/gm;

interface Mark {
  label: string;
  start: number;
}

function marks(text: string): Mark[] {
  return [...text.matchAll(MARKER)].map((m) => ({ label: m[1] as string, start: m.index }));
}

const tidy = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** The first and last marker a citation names: `p4–p5` → p4 and p5; `p12` → p12 twice. */
function ends(locator: string): [string, string] {
  const parts = locator.split(/\s*[–—]\s*|\s+-\s+|\s*,\s*/).map(tidy).filter(Boolean);
  return [parts[0] ?? tidy(locator), parts[parts.length - 1] ?? tidy(locator)];
}

/** A marker stands for a page when it is that page or a merged run that starts or ends with it (`p4–p6`). */
function names(mark: Mark, page: string): boolean {
  const label = tidy(mark.label);
  if (label === page) return true;
  const [first, last] = ends(mark.label);
  return first === page || last === page;
}

/**
 * At most `limit` characters from `text` around where the idea is taught: the cited pages, centred on
 * the idea's name when it appears there. Without a usable citation it looks for the name anywhere,
 * and only then falls back to the start of the text.
 */
export function passageFor(text: string, locator: string | undefined, name: string, limit = 1800): string {
  const all = marks(text);
  let from = 0;
  let to = text.length;
  let cited = false;
  if (locator) {
    const [first, last] = ends(locator);
    const startAt = all.findIndex((m) => names(m, first));
    if (startAt >= 0) {
      cited = true;
      from = (all[startAt] as Mark).start;
      let endAt = startAt;
      for (let i = startAt; i < all.length; i += 1) if (names(all[i] as Mark, last)) endAt = i;
      to = all[endAt + 1]?.start ?? text.length;
    }
  }
  const range = text.slice(from, to);
  if (range.length <= limit) return range.trim();
  const at = name.trim() ? range.toLowerCase().indexOf(name.trim().toLowerCase()) : -1;
  if (at < 0) return cited || !name.trim() ? `${clip(range, 0, limit)} …` : `${clip(text, 0, limit)} …`;
  // a third of the window before the name, so the sentence that introduces it is there
  const start = Math.max(0, Math.min(at - Math.floor(limit / 3), range.length - limit));
  return `${start > 0 ? '… ' : ''}${clip(range, start, limit)}${start + limit < range.length ? ' …' : ''}`;
}

/** `limit` characters from `start`, moved to word boundaries so no word is cut. */
function clip(text: string, start: number, limit: number): string {
  let a = start;
  if (a > 0) {
    const space = text.indexOf(' ', a);
    if (space >= 0 && space - a < 40) a = space + 1;
  }
  let b = Math.min(text.length, a + limit);
  if (b < text.length) {
    const space = text.lastIndexOf(' ', b);
    if (space > a && b - space < 40) b = space;
  }
  return text.slice(a, b).trim();
}
