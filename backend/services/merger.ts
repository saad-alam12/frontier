/**
 * The merger: the one writer of the world layer, nodes and chains (design §11.2, "One writer per
 * store"). Everything that changes the map goes through these entry points, and only this module
 * may import `store/worldWrites` (a lint rule enforces it). The plans come from pure code
 * (`core/merge`, `core/ideaMerge`); each entry point runs inside the caller's transaction, so a
 * write to the map commits or rolls back with the work around it.
 */
import type { Database } from '../store/db';
import type { MergePlan } from '../core/merge';
import type { IdeaMergePlan } from '../core/ideaMerge';
import type { KnowledgeNode } from '../core/types';
import { applyIdeaEdit, applyIdeaMerge, applyMergePlan, createUnverifiedNodes, deleteMergedNode, dropSourceRefs, retireNodes } from '../store/worldWrites';

/** What reading a source part, or a session the learner made, found: new ideas, chains and citations. */
export function mergeIntoMap(db: Database, plan: MergePlan): void {
  applyMergePlan(db, plan);
}

/** A goal's compile (or an addition to it) names ideas no source has grounded yet. */
export function addUnverifiedIdeas(db: Database, ideas: Omit<KnowledgeNode, 'status' | 'sources'>[]): void {
  if (ideas.length) createUnverifiedNodes(db, ideas);
}

/** Ideas that leave the map with every chain that uses them: a source read again, or the learner erasing. */
export function retireIdeas(db: Database, ids: readonly string[]): void {
  retireNodes(db, ids);
}

/** A source left the Library: what stays on the map stops citing it. */
export function stopCiting(db: Database, sourceId: string): void {
  dropSourceRefs(db, sourceId);
}

/** The learner renamed an idea or corrected its statement. */
export function writeIdeaEdit(db: Database, nodeId: string, edit: { name: string; statement: string; aliases: string[] }): void {
  applyIdeaEdit(db, nodeId, edit);
}

/**
 * The learner merged two ideas: the kept one takes the names, citations and chains; `moveTheRest`
 * moves what other stores hold on the dropped one (evidence, targets, notes); then the dropped one goes.
 */
export function writeIdeaMerge(db: Database, plan: IdeaMergePlan, moveTheRest: () => void): void {
  applyIdeaMerge(db, plan);
  moveTheRest();
  deleteMergedNode(db, plan.dropId);
}
