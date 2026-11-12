/**
 * When a misconception ends (design §5.2). A misconception stays on the tutor's list and gets
 * contrast problems until the learner's answers show it is gone. Pure.
 */
import { reviewRole } from './nodeState';
import { PASS_SCORE } from './types';
import type { Bug, Evidence } from './types';

/** Clean answers about the idea, after the misconception was last seen, for it to count as gone. */
export const CLEAN_ANSWERS = 2;
/**
 * One of them has to come at least this long after it was last seen. Right after a correction the
 * right answer is still in short-term memory, so it shows nothing about the misconception.
 */
export const HELD_AFTER_MS = 12 * 3_600_000;

/**
 * True when the misconception can be taken as gone: since it was last seen the learner answered
 * about the idea cleanly (a passing answer of their own, not credit passed down from another idea)
 * at least twice, one of those at least half a day later.
 */
export function hasEnded(bug: Pick<Bug, 'lastSeen'>, evidence: Evidence[]): boolean {
  const seen = Date.parse(bug.lastSeen);
  const clean = evidence.filter((e) => reviewRole(e) === 'direct' && e.score >= PASS_SCORE && Date.parse(e.at) > seen);
  return clean.length >= CLEAN_ANSWERS && clean.some((e) => Date.parse(e.at) - seen >= HELD_AFTER_MS);
}

/** Words that carry no meaning of their own in a one-sentence description of a belief. */
const STOP = new Set('the a an of to in on for and or but is are was were be been being that this these those it its as at by with from than then so if not no do does did can could would should will they them their there what which who whom when where why how all any each every some such only own same other into over under about after before between both more most less very just also thinks think believes believe learner student'.split(' '));

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/\$[^$]*\$/g, ' math ')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w))
      // a crude stem, so "deviates" and "deviation" meet
      .map((w) => w.replace(/(ations?|ing|ed|es|s)$/, '')),
  );
}

/** Share of words two descriptions have in common for them to be the same belief said twice. */
export const SAME_WORDS = 0.6;

/** The same misconception, worded alike: the same sentence, or most of the same words. */
export function sameMisconception(a: string, b: string): boolean {
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return true;
  const [x, y] = [contentWords(a), contentWords(b)];
  if (x.size < 3 || y.size < 3) return false;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (x.size + y.size - shared) >= SAME_WORDS;
}

/**
 * The recorded misconception an answer shows again, if any: an open one first, else the one ended
 * most recently (seen again, it is open again). The tutor and the grader are shown the open ones and
 * asked to repeat a listed one word for word when it is the same belief, so a match by meaning mostly
 * arrives as the same sentence; this also catches the same belief reworded.
 */
export function matchMisconception<T extends Pick<Bug, 'description' | 'resolvedAt'>>(shown: string, bugs: T[]): T | null {
  const open = bugs.filter((b) => b.resolvedAt === null && sameMisconception(shown, b.description));
  if (open[0]) return open[0];
  const ended = bugs.filter((b) => b.resolvedAt !== null && sameMisconception(shown, b.description)).sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''));
  return ended[0] ?? null;
}
