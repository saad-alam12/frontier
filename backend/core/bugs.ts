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
