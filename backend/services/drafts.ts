/** What the learner was writing and has not sent, kept per field so closing the app loses nothing. */
import type { Database } from '../store/db';
import { getDrafts, setDraft } from '../store/drafts';

export function draftsFor(db: Database, keys: string[]): Record<string, string> {
  return getDrafts(db, keys);
}

/** An empty value forgets the draft. */
export function keepDraft(db: Database, key: string, value: string): void {
  setDraft(db, key, value);
}
