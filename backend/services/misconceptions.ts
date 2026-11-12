/**
 * The Misconceptions view (design §5.2, "Bugs"): every wrong belief an answer showed, open ones first,
 * with when it was first and last seen, and the goals that need its idea (for a contrast problem).
 */
import { CLEAN_ANSWERS } from '../core/bugs';
import { reviewRole } from '../core/nodeState';
import { PASS_SCORE } from '../core/types';
import type { Database } from '../store/db';
import { listEvidenceForNode } from '../store/evidence';
import { listCapabilities, listGoals, listTargets } from '../store/goals';
import { getNode } from '../store/world';

export interface MisconceptionView {
  id: string;
  nodeId: string;
  idea: string;
  description: string;
  firstSeen: string;
  lastSeen: string;
  /** When it ended (clean answers since), or null while it is open. */
  endedAt: string | null;
  /** Clean answers since it was last seen, of the two it takes to end. */
  cleanSince: number;
  /** An active goal that needs the idea, for practising it. */
  goalId: string | null;
}

interface BugRow {
  id: string;
  node_id: string;
  description: string;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
}

export function misconceptionsView(db: Database): MisconceptionView[] {
  const active = new Set(listGoals(db).filter((g) => g.status === 'active').map((g) => g.id));
  const goalOfCap = new Map(listCapabilities(db).map((c) => [c.id, c.goalId]));
  const goalOf = new Map<string, string>();
  for (const t of listTargets(db)) {
    const g = goalOfCap.get(t.capabilityId);
    if (g && active.has(g) && !goalOf.has(t.nodeId)) goalOf.set(t.nodeId, g);
  }
  const rows = db.prepare('SELECT * FROM bugs ORDER BY resolved_at IS NOT NULL, last_seen DESC').all() as unknown as BugRow[];
  return rows.flatMap((r) => {
    const node = getNode(db, r.node_id);
    if (!node) return [];
    const seen = Date.parse(r.last_seen);
    // counted as core/bugs.ts `hasEnded` counts them: passing answers of the learner's own since it was last seen
    const clean = r.resolved_at ? 0 : listEvidenceForNode(db, r.node_id).filter((e) => Date.parse(e.at) > seen && e.score >= PASS_SCORE && reviewRole(e) === 'direct').length;
    return [{ id: r.id, nodeId: r.node_id, idea: node.name, description: r.description, firstSeen: r.first_seen, lastSeen: r.last_seen, endedAt: r.resolved_at, cleanSince: Math.min(clean, CLEAN_ANSWERS), goalId: goalOf.get(r.node_id) ?? null }];
  });
}
