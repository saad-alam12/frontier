/**
 * Misconceptions (design §5.2): the one writer of the bugs table. An answer that shows one puts it
 * on record, or marks it as seen again; answers that show none let it end.
 */
import { hasEnded } from '../core/bugs';
import type { Database } from '../store/db';
import { listBugsForNode, recordBug, resolveBug, touchBug } from '../store/bugs';
import { listEvidenceForNode } from '../store/evidence';

/**
 * Call after an answer about an idea was judged and its evidence written. `misconception` is what the
 * answer showed, if anything; `at` is when the learner answered (a practice grade can arrive later).
 */
export function afterAnswer(db: Database, nodeId: string, misconception: string | null, at: string = new Date().toISOString()): void {
  const open = listBugsForNode(db, nodeId);
  const shown = misconception?.trim();
  if (shown) {
    const again = open.find((b) => b.description.toLowerCase() === shown.toLowerCase());
    if (again) touchBug(db, again.id, at);
    else recordBug(db, nodeId, shown, at);
    return;
  }
  if (open.length === 0) return;
  const evidence = listEvidenceForNode(db, nodeId);
  for (const bug of open) if (hasEnded(bug, evidence)) resolveBug(db, bug.id, at);
}
