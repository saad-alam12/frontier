/**
 * Goal mechanics (design §3): the depth-distribution sanity check and the status of a skill.
 */
import type { Depth } from './types';

/** Above this share of targets at depth 3 or more, a compile is over-targeting (design §2.3: most ideas need 1–2). */
export const DEEP_TARGET_LIMIT = 0.5;

/** Share of targets at depth 3 or more, and whether it is suspiciously high. */
export function depthSkew(depths: Depth[]): { deepShare: number; overTargeted: boolean } {
  if (depths.length === 0) return { deepShare: 0, overTargeted: false };
  const deepShare = depths.filter((d) => d >= 3).length / depths.length;
  return { deepShare, overTargeted: deepShare > DEEP_TARGET_LIMIT };
}

export type SkillStatus = 'ready' | 'learning' | 'not_started';

/** Ready when mastered or every target is at its depth; learning once any target has evidence. */
export function skillStatus(masteredAt: string | null, targets: { depth: Depth; currentDepth: Depth }[]): SkillStatus {
  if (masteredAt || (targets.length > 0 && targets.every((t) => t.currentDepth >= t.depth))) return 'ready';
  return targets.some((t) => t.currentDepth > 0) ? 'learning' : 'not_started';
}
