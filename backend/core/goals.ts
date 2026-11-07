/**
 * Goal mechanics (design §3): the depth-distribution sanity check, the status of a skill, and when
 * missing background or an edit calls for a new map.
 */
import type { Depth, GoalLevel, GoalRemap, RemapCause } from './types';

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

/** Missing background below this many hours is left to the tutor, idea by idea. */
export const MIN_GAP_HOURS = 1;
/** Missing background that fits in this share of the time left is added to the map; more calls for a gentler map. */
export const REMAP_SHARE = 0.25;

export type RemapNeed = 'none' | 'fill' | 'simplify';

/**
 * What the learner's missing background asks of the map (design §3.2): nothing when it is small;
 * `fill` (add the missing ideas) when the time left covers it; `simplify` (a gentler map, and a
 * separate goal for the background) when it does not. No budget means the time covers it.
 */
export function remapNeed(gaps: { hours: number }[], hoursLeft: number | null): RemapNeed {
  const total = gaps.reduce((sum, g) => sum + Math.max(0, g.hours), 0);
  if (total < MIN_GAP_HOURS) return 'none';
  if (hoursLeft === null || total <= REMAP_SHARE * hoursLeft) return 'fill';
  return 'simplify';
}

/** What the learner sets on a goal that the map is drawn around, beyond its sentence and time. */
export interface MapShaping {
  context: string | null;
  /** The depth wanted with no time limit; null for a goal fitted to a time. */
  wantedLevel: GoalLevel | null;
}

/**
 * What an edit changed that calls for a new map (design §3.2): a mapped goal asks for one when its
 * context changes, or how deep it should go: another wanted level, or a switch between a time and no
 * time limit (a map sized to a time does not hold what a depth needs, and the other way round).
 * A new amount of time is not a cause: the plan re-fits the same map. Whitespace alone is not a change.
 */
export function remapCauses(before: MapShaping, after: MapShaping): RemapCause[] {
  const causes: RemapCause[] = [];
  if ((before.context ?? '').trim() !== (after.context ?? '').trim()) causes.push('context');
  if (before.wantedLevel !== after.wantedLevel) causes.push('level');
  return causes;
}

/**
 * A model run started from the goal's re-map state; it may write its result only while that state is
 * still the latest. A request made meanwhile is newer and is drawn next.
 */
export function sameRemap(a: GoalRemap | null, b: GoalRemap | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
