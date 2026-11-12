/**
 * Erase from the map (Settings): the whole map, chosen topics, chosen sources or chosen ideas. Each
 * store's own removal function does its part, all in one transaction; a preview counts the same plan
 * without changing anything, for the confirm dialog.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { cardsOnlyOn, deleteUntaggedCards } from '../store/cards';
import type { Database } from '../store/db';
import { transaction } from '../store/db';
import { deleteEmbeddings } from '../store/embeddings';
import { nodesWithEvidence } from '../store/evidence';
import { deleteCapabilities, forgetCompiledSource, listCapabilities, listGoals, listTargets, removeMaterialsOf, removeTargetsOf, resetGoalMap, saveRemap } from '../store/goals';
import { closePracticeSet, openSetsWith } from '../store/practice';
import { activeSession } from '../store/sessions';
import { coveredNodeIds, coveredOutside, deleteSource, getSource, listSources } from '../store/sources';
import { figureFilesInUse, listFigures } from '../store/figures';
import { listChains, listNodes } from '../store/world';
import { retireIdeas, stopCiting } from './merger';
import { eraseEvidenceFor } from './evidence';
import { refreshGoalFields } from './knowledge';
import { mapView } from './map';

const ids = z.array(z.string().min(1)).min(1);

export const EraseRequestSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('everything') }),
  z.object({ scope: z.literal('topics'), ids }),
  z.object({ scope: z.literal('sources'), ids }),
  z.object({ scope: z.literal('ideas'), ids }),
]);
export type EraseRequest = z.infer<typeof EraseRequestSchema>;
export type EraseScope = EraseRequest['scope'];

export interface ErasePreview {
  ideas: number;
  links: number;
  /** Erased ideas the learner has evidence on. */
  learned: number;
  /** Sources removed from the Library. */
  sources: number;
  /** Flashcards left with no idea, which go too. */
  cards: number;
}

export interface EraseResult extends ErasePreview {
  /** Goals left with no map: they count as never compiled, and the caller asks the goal worker to map them again. */
  goalsToMap: string[];
}

export interface EraseDeps {
  db: Database;
  /** Where the app keeps its copies of added files. */
  sourcesDir: string;
  /** Where the pictures of picture pages are kept; a removed source's pictures that nothing else uses are deleted. */
  figuresDir?: string;
  /** A source being read would write ideas for a source that no longer exists. */
  isReading?: (sourceId: string) => boolean;
}

interface ErasePlan {
  nodeIds: Set<string>;
  sourceIds: string[];
  chainIds: string[];
  learned: number;
  cards: number;
}

function planErase(db: Database, request: EraseRequest): ErasePlan {
  let nodeIds: Set<string>;
  let sourceIds: string[] = [];
  if (request.scope === 'everything') {
    nodeIds = new Set(listNodes(db).map((n) => n.id));
    sourceIds = listSources(db).map((s) => s.id);
  } else if (request.scope === 'ideas') {
    const known = new Set(listNodes(db).map((n) => n.id));
    nodeIds = new Set(request.ids.filter((id) => known.has(id)));
  } else if (request.scope === 'topics') {
    // Topics are derived, not stored: resolve them exactly as the map shows them.
    const chosen = new Set(request.ids);
    nodeIds = new Set(mapView(db).nodes.filter((n) => n.topic !== null && chosen.has(n.topic)).map((n) => n.id));
  } else {
    sourceIds = request.ids.filter((id) => getSource(db, id) !== undefined);
    const backedElsewhere = coveredOutside(db, sourceIds);
    nodeIds = new Set(sourceIds.flatMap((id) => coveredNodeIds(db, id)).filter((id) => !backedElsewhere.has(id)));
  }
  const chainIds = listChains(db)
    .filter((c) => nodeIds.has(c.conclusion) || c.premises.some((p) => nodeIds.has(p)))
    .map((c) => c.id);
  const withEvidence = nodesWithEvidence(db);
  const learned = [...nodeIds].filter((id) => withEvidence.has(id)).length;
  return { nodeIds, sourceIds, chainIds, learned, cards: cardsOnlyOn(db, nodeIds).length };
}

const countsOf = (plan: ErasePlan): ErasePreview => ({ ideas: plan.nodeIds.size, links: plan.chainIds.length, learned: plan.learned, sources: plan.sourceIds.length, cards: plan.cards });

/** What `eraseFromMap` would remove, changing nothing. */
export function previewErase(db: Database, request: EraseRequest): ErasePreview {
  return countsOf(planErase(db, request));
}

/**
 * Erase for good. Ideas go with every chain touching them, their evidence and states (the one
 * exception to append-only evidence, because the learner asked), embeddings and goal targets; worked
 * examples, coverage and misconceptions on them go by cascade, and so do their flashcard tags; a
 * flashcard left with no idea goes too. Sources go from the Library with their
 * stored files. Past sessions and practice stay, so trails still replay (by the names they recorded);
 * open practice and probe sets that ask about an erased idea are closed. Goals keep their other targets
 * and are re-planned; a goal left with no capabilities, and every goal when the whole map goes, is reset
 * to be mapped again. Settings are never touched.
 */
export function eraseFromMap(deps: EraseDeps, request: EraseRequest): EraseResult {
  const { db } = deps;
  if (activeSession(db)) throw new Error('End or finish the open session first, then erase.');
  const plan = planErase(db, request);
  if (plan.sourceIds.some((id) => deps.isReading?.(id))) throw new Error('A source you chose is being read right now. Wait until it finishes, then erase.');
  const files = plan.sourceIds.map((id) => getSource(db, id)?.path).filter((p): p is string => Boolean(p));
  const pictures = plan.sourceIds.flatMap(pictureFiles(db));
  const ideas = [...plan.nodeIds];

  const goalsToMap = transaction(db, () => {
    const capabilityGoal = new Map(listCapabilities(db).map((c) => [c.id, c.goalId]));
    const touchedGoals = new Set(
      listTargets(db, undefined, { all: true })
        .filter((t) => plan.nodeIds.has(t.nodeId))
        .map((t) => capabilityGoal.get(t.capabilityId))
        .filter((g): g is string => g !== undefined),
    );

    eraseEvidenceFor(db, ideas);
    deleteEmbeddings(db, ideas);
    removeTargetsOf(db, ideas);
    for (const setId of openSetsWith(db, plan.nodeIds)) closePracticeSet(db, setId);
    retireIdeas(db, ideas);
    deleteUntaggedCards(db);
    removeMaterialsOf(db, plan.sourceIds);
    for (const id of plan.sourceIds) {
      stopCiting(db, id);
      deleteSource(db, id);
    }

    const reset: string[] = [];
    for (const goal of listGoals(db)) {
      if (request.scope === 'everything') {
        resetGoalMap(db, goal.id);
        reset.push(goal.id);
        continue;
      }
      // a proposed re-map that targets an erased idea could no longer be applied
      if (goal.remap?.state === 'ready' && ideas.some((id) => JSON.stringify(goal.remap).includes(id))) saveRemap(db, goal.id, null);
      if (!touchedGoals.has(goal.id)) continue;
      const targeted = new Set(listTargets(db, goal.id, { all: true }).map((t) => t.capabilityId));
      const capabilities = listCapabilities(db, goal.id);
      deleteCapabilities(
        db,
        capabilities.filter((c) => c.masteredAt === null && !targeted.has(c.id)).map((c) => c.id),
      );
      if (listCapabilities(db, goal.id).length === 0) {
        resetGoalMap(db, goal.id);
        reset.push(goal.id);
      }
    }
    refreshGoalFields(db);
    return reset;
  });

  for (const file of files) {
    try {
      rmSync(join(deps.sourcesDir, file), { force: true });
    } catch {
      // The database is already erased; a stored copy that cannot be removed is unused and harmless.
    }
  }
  deleteUnusedPictures(deps, pictures);
  return { ...countsOf(plan), goalsToMap };
}

const pictureFiles = (db: Database) => (sourceId: string) => listFigures(db, sourceId).flatMap((f) => (f.file ? [f.file] : []));

/** Delete pictures of removed sources that no other source uses (two sources can share a picture). */
function deleteUnusedPictures(deps: EraseDeps, files: string[]): void {
  if (!deps.figuresDir || files.length === 0) return;
  const inUse = figureFilesInUse(deps.db);
  for (const file of files) {
    if (inUse.has(file)) continue;
    try {
      rmSync(join(deps.figuresDir, file), { force: true });
    } catch {
      // an unused picture that cannot be removed is harmless
    }
  }
}

/**
 * Take a source out of the Library and keep what was read from it ("Remove from library"). Its
 * ideas and links stay on the map and only stop citing it; goals that used it as material no longer
 * list it; its stored copy is deleted. To erase the ideas too, use "Erase from your map".
 */
export function removeSource(deps: EraseDeps, sourceId: string): void {
  const { db } = deps;
  const source = getSource(db, sourceId);
  if (!source) return;
  if (deps.isReading?.(sourceId)) throw new Error('This source is being read right now. Wait until it finishes, then remove it.');
  const pictures = pictureFiles(db)(sourceId);
  transaction(db, () => {
    stopCiting(db, sourceId);
    for (const goal of listGoals(db)) forgetCompiledSource(db, goal.id, sourceId);
    deleteSource(db, sourceId); // its parts, its coverage, its picture pages and its place in goals' material go with it
  });
  deleteUnusedPictures(deps, pictures);
  if (!source.path) return;
  try {
    rmSync(join(deps.sourcesDir, source.path), { force: true });
  } catch {
    // The source is gone from the Library; a stored copy that cannot be removed is unused and harmless.
  }
}
