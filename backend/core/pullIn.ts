/**
 * Pulling a missing prerequisite into a session (design §4.1, "Teach"), pure: when the tutor's grade
 * names a foundation the learner plainly lacks, find it among the ideas the current one is built on.
 * Only an idea that is learnable now (its own premises are the learner's) can be pulled in: anything
 * further back is for another session, and the idea is simplified instead.
 */

export interface PullCandidate {
  id: string;
  name: string;
  aliases: string[];
  /** Steps back from the current idea: 1 for a direct premise. */
  hops: number;
}

/** A name as compared: lower case, without math markers, punctuation or extra spaces. */
export function plainName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[$\\{}()[\]"'`.,;:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MIN_CONTAINED = 5;

/**
 * The candidate the named gap is, or null. An exact name (or another name of it) wins; then a name
 * that holds the gap's words or is held by them; among equals, the closer premise.
 */
export function premiseToPullIn(gap: string, candidates: PullCandidate[]): string | null {
  const wanted = plainName(gap);
  if (!wanted) return null;
  const score = (c: PullCandidate): number | null => {
    const names = [c.name, ...c.aliases].map(plainName).filter(Boolean);
    if (names.includes(wanted)) return 0;
    const contained = names.some((n) => (n.length >= MIN_CONTAINED && wanted.includes(n)) || (wanted.length >= MIN_CONTAINED && n.includes(wanted)));
    return contained ? 1 : null;
  };
  const ranked = candidates
    .map((c) => ({ c, s: score(c) }))
    .filter((x): x is { c: PullCandidate; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s || a.c.hops - b.c.hops || a.c.name.localeCompare(b.c.name));
  return ranked[0]?.c.id ?? null;
}
