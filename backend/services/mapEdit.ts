/**
 * Editing the map by hand (design §8, "Editing the map"): rename an idea, correct its statement, or
 * merge two ideas that are the same. The world layer is written only through the merger's entry points
 * (store/world.ts), evidence only through the evidence service; everything else that names an idea is
 * re-pointed in the same transaction.
 */
import { planIdeaEdit, planIdeaMerge } from '../core/ideaMerge';
import { cosine } from '../ingest/similarity';
import type { Database } from '../store/db';
import { transaction } from '../store/db';
import { openDialogueWith } from '../store/dialogues';
import { listEmbeddings } from '../store/embeddings';
import { mergeTargets } from '../store/goals';
import { ideaNotesFor, saveIdeaNote } from '../store/ideaNotes';
import { openSetsWith } from '../store/practice';
import { repointIdeaReferences } from '../store/references';
import { activeSession } from '../store/sessions';
import { applyIdeaEdit, applyIdeaMerge, deleteMergedNode, getNode, listChains, searchNodesByName } from '../store/world';
import { mergeEvidenceInto } from './evidence';
import { refreshGoalFields } from './knowledge';

export const NAME_CHARS = 120;
export const STATEMENT_CHARS = 1200;
/** Ideas offered as likely duplicates. */
const CANDIDATES = 6;
/** Closer than this in meaning is worth offering as a duplicate. */
const SIMILAR = 0.82;

export interface MergeCandidate {
  id: string;
  name: string;
  statement: string;
}

/** Rename an idea or correct its statement; the old name stays as another name of it. */
export function editIdea(db: Database, nodeId: string, edit: { name: string; statement: string }): { changed: boolean } {
  const node = getNode(db, nodeId);
  if (!node) throw new Error('That idea is no longer on your map.');
  if (edit.name.trim().length > NAME_CHARS) throw new Error(`A name can be at most ${NAME_CHARS} characters.`);
  if (edit.statement.trim().length > STATEMENT_CHARS) throw new Error(`A statement can be at most ${STATEMENT_CHARS} characters.`);
  const planned = planIdeaEdit(node, edit);
  if (!planned) return { changed: false };
  transaction(db, () => applyIdeaEdit(db, nodeId, planned));
  return { changed: true };
}

/**
 * Merge `dropId` into `keepId`: one idea afterwards, with both names, every chain, both ideas' evidence
 * (its state derived again), goal targets, flashcards, misconceptions, notes and history. Refused while
 * an open session, practice set or conversation uses either, since their plans name them.
 */
export function mergeIdeas(db: Database, keepId: string, dropId: string): { keepId: string } {
  const keep = getNode(db, keepId);
  const drop = getNode(db, dropId);
  if (!keep || !drop) throw new Error('One of these ideas is no longer on your map.');
  if (keepId === dropId) throw new Error('An idea cannot be merged with itself.');
  const pair = new Set([keepId, dropId]);
  const session = activeSession<{ nodeStatus?: Record<string, unknown> }>(db);
  if (session && Object.keys(session.state.nodeStatus ?? {}).some((id) => pair.has(id))) throw new Error('A session that is open uses one of these ideas. Finish or end it first.');
  if (openSetsWith(db, pair).length > 0) throw new Error('Practice or a check that is open uses one of these ideas. Finish or leave it first.');
  if (openDialogueWith(db, pair)) throw new Error('An oral exam or teach-back that is open uses one of these ideas. End it first.');

  const plan = planIdeaMerge(keep, drop, listChains(db));
  transaction(db, () => {
    applyIdeaMerge(db, plan);
    mergeEvidenceInto(db, dropId, keepId);
    mergeTargets(db, dropId, keepId);
    const notes = ideaNotesFor(db, [keepId, dropId]);
    const dropNote = notes.get(dropId);
    if (dropNote) saveIdeaNote(db, keepId, [notes.get(keepId), dropNote].filter(Boolean).join('\n\n'));
    repointIdeaReferences(db, dropId, keepId);
    deleteMergedNode(db, dropId);
    refreshGoalFields(db);
  });
  return { keepId };
}

/** Ideas that may be the same as this one: close in meaning, or matching what the learner typed. */
export function mergeCandidates(db: Database, nodeId: string, query = ''): MergeCandidate[] {
  const node = getNode(db, nodeId);
  if (!node) throw new Error('That idea is no longer on your map.');
  const view = (n: { id: string; name: string; statement: string }) => ({ id: n.id, name: n.name, statement: n.statement });
  const q = query.trim().toLowerCase();
  if (q) {
    // names first: a name that starts with the words, then one that holds them, then other names, then statements
    const rank = (n: { name: string; aliases: string[] }) => (n.name.toLowerCase().startsWith(q) ? 0 : n.name.toLowerCase().includes(q) ? 1 : n.aliases.some((a) => a.toLowerCase().includes(q)) ? 2 : 3);
    return searchNodesByName(db, query.trim(), 60)
      .filter((n) => n.id !== nodeId)
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
      .slice(0, CANDIDATES)
      .map(view);
  }
  const all = listEmbeddingsAnyModel(db, nodeId);
  const own = all.find((e) => e.nodeId === nodeId);
  if (!own) return [];
  return all
    .filter((e) => e.nodeId !== nodeId && e.model === own.model)
    .map((e) => ({ id: e.nodeId, score: cosine(own.vector, e.vector) }))
    .filter((e) => e.score >= SIMILAR)
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATES)
    .flatMap((e) => {
      const n = getNode(db, e.id);
      return n ? [view(n)] : [];
    });
}

/** The embeddings of the model this idea was embedded with. */
function listEmbeddingsAnyModel(db: Database, nodeId: string) {
  const row = db.prepare('SELECT model FROM node_embeddings WHERE node_id = ?').get(nodeId) as { model: string } | undefined;
  return row ? listEmbeddings(db, row.model) : [];
}
