/**
 * "I already know this material" (R8 E1, design §3.1): a source the learner marked as known makes the
 * ideas it covers open with a check instead of teaching, until an answer says how well they know them.
 * The flag is a claim, not an answer: it creates no evidence and no depth.
 */
import type { Database } from '../store/db';
import { checkedNodes, getState } from '../store/evidence';
import { knownMaterialByNode } from '../store/sources';

/**
 * The known sources an idea's step opens with a check for (their titles), or null when it is taught as
 * usual: no known source covers it, its aim is a first look (a short pass already), the learner already
 * has it at the aim, or it was checked before (the check, or a probe question, already said how well).
 */
export function checkFirstSources(db: Database, nodeId: string, aim: number): string[] | null {
  if (aim < 2) return null;
  const titles = knownMaterialByNode(db).get(nodeId);
  if (!titles?.length) return null;
  if ((getState(db, nodeId)?.depth ?? 0) >= aim) return null;
  if (checkedNodes(db).has(nodeId)) return null;
  return titles;
}

/** Ideas a known source covers that were not checked yet: the plan prices them at a check until an answer says otherwise. */
export function uncheckedKnownIdeas(db: Database): Set<string> {
  const known = knownMaterialByNode(db);
  if (known.size === 0) return new Set();
  const checked = checkedNodes(db);
  return new Set([...known.keys()].filter((id) => !checked.has(id)));
}
