/**
 * What adding to a goal does to its plan (design §3.2, additions): the ideas that join, and what
 * changes for the ideas it already planned when a fixed time has to make room. Pure: the service gives
 * it the goal's planned depths before and after.
 */

export interface PlannedIdea {
  nodeId: string;
  /** The depth the plan gives the idea for this goal; 0 when the time leaves it out. */
  plannedDepth: number;
}

export interface PlanDiff {
  /** Ideas the plan holds now and did not before: the addition's, with their planned depth. */
  joined: PlannedIdea[];
  /** Ideas the addition brings that the time cannot hold. */
  missed: string[];
  /** Ideas planned in depth before that become overviews. */
  overview: string[];
  /** Ideas planned before that are left out now. */
  leftOut: string[];
  /** Ideas still planned in depth, but less deep than before (derived becomes explained). */
  shallower: string[];
}

/** Planned at 2 or more: explained or deeper ("in depth"); 1 is an overview (design §3.4). */
const IN_DEPTH = 2;

export function planDiff(before: PlannedIdea[], after: PlannedIdea[]): PlanDiff {
  const was = new Map(before.map((i) => [i.nodeId, i.plannedDepth]));
  const diff: PlanDiff = { joined: [], missed: [], overview: [], leftOut: [], shallower: [] };
  for (const idea of after) {
    const prev = was.get(idea.nodeId);
    const now = idea.plannedDepth;
    if (prev === undefined || prev === 0) {
      if (now > 0) diff.joined.push(idea);
      else if (prev === undefined) diff.missed.push(idea.nodeId);
    } else if (now === 0) diff.leftOut.push(idea.nodeId);
    else if (prev >= IN_DEPTH && now < IN_DEPTH) diff.overview.push(idea.nodeId);
    else if (now < prev) diff.shallower.push(idea.nodeId);
  }
  return diff;
}
