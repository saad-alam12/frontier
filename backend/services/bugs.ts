/**
 * Misconceptions (design §5.2): the one writer of the bugs table. An answer that shows one puts it
 * on record, or marks it as seen again; answers that show none let it end.
 */
import { hasEnded, matchMisconception } from '../core/bugs';
import type { Database } from '../store/db';
import { listBugsForNode, recordBug, resolveBug, touchBug } from '../store/bugs';
import { listEvidenceForNode } from '../store/evidence';

/**
 * Call after an answer about an idea was judged and its evidence written. `misconception` is what the
 * answer showed, if anything; `at` is when the learner answered (a practice grade can arrive later).
 */
export function afterAnswer(db: Database, nodeId: string, misconception: string | null, at: string = new Date().toISOString()): void {
  const shown = misconception?.trim();
  if (shown) {
    // the same belief again, by meaning: it is marked seen (and open again if it had ended)
    const again = matchMisconception(shown, listBugsForNode(db, nodeId, true));
    if (again) touchBug(db, again.id, at);
    else recordBug(db, nodeId, shown, at);
    return;
  }
  const open = listBugsForNode(db, nodeId);
  if (open.length === 0) return;
  const evidence = listEvidenceForNode(db, nodeId);
  for (const bug of open) if (hasEnded(bug, evidence)) resolveBug(db, bug.id, at);
}

/** The learner says a misconception on record is not theirs (an answer read wrongly): it ends now. */
export function dismissMisconception(db: Database, bugId: string, now = new Date()): void {
  const row = db.prepare('SELECT id FROM bugs WHERE id = ? AND resolved_at IS NULL').get(bugId);
  if (!row) throw new Error('That misconception has already ended.');
  resolveBug(db, bugId, now.toISOString());
}
