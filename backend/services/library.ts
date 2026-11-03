/** Read models for the Library screen: sources with chunk progress, and the delta view per source. */
import { classifyDelta } from '../core/delta';
import type { DeltaClass } from '../core/delta';
import { EXTRACTED_ROLES, EXTRACTION } from '../core/types';
import type { Depth, MaterialRole, Source } from '../core/types';
import { rolesOfSource } from '../store/goals';
import type { Database } from '../store/db';
import { activeSession } from '../store/sessions';
import { coveredNodeIds, listChunks, listSources } from '../store/sources';
import type { SourceChunk } from '../store/sources';
import { afterSourceReread } from './goals';
import type { IngestionService } from './ingestion';
import { loadKnowledge, refreshGoalFields } from './knowledge';
import { targetDepthFor } from '../core/leverage';

export interface SourceSummary extends Source {
  chunks: { idx: number; locator: string; status: SourceChunk['status']; error: string | null; nodeCount: number }[];
  nodeCount: number;
  /** Roles this source plays in goals. */
  roles: MaterialRole[];
  /** False when every goal uses it only for practice, assessment or scope: it is kept as text, not read into ideas. */
  readsIdeas: boolean;
  /** Read with the old extraction (many small ideas); reading it again gives lesson-sized ones. */
  readOld: boolean;
}

/**
 * Read a source again with the current extraction (design §7): its ideas that nothing depends on are
 * retired, goals using it compile it afresh, and it is queued. Refused while a session is open.
 */
export async function readSourceAgain(db: Database, ingestion: IngestionService, sourceId: string): Promise<{ retired: number }> {
  if (activeSession(db)) throw new Error('End or finish the open session first, then read this source again.');
  const { retired } = await ingestion.prepareReread(sourceId);
  afterSourceReread(db, sourceId);
  refreshGoalFields(db);
  ingestion.start(sourceId);
  return { retired: retired.length };
}

export function listSourceSummaries(db: Database): SourceSummary[] {
  return listSources(db).map((s) => {
    const chunks = listChunks(db, s.id);
    const roles = [...new Set(rolesOfSource(db, s.id).map((r) => r.role))];
    return {
      ...s,
      roles,
      readsIdeas: roles.length === 0 || roles.some((r) => EXTRACTED_ROLES.includes(r)),
      readOld: s.extraction < EXTRACTION && s.chunksDone > 0,
      nodeCount: coveredNodeIds(db, s.id).length,
      chunks: chunks.map((c) => ({ idx: c.idx, locator: c.locator, status: c.status, error: c.error, nodeCount: c.nodeIds.length })),
    };
  });
}

export interface IdeaRef {
  id: string;
  name: string;
}

export interface DeltaItem {
  nodeId: string;
  name: string;
  kind: string;
  statement: string;
  cls: DeltaClass;
  depth: Depth;
  targetDepth: Depth;
  /** Position of first appearance in the source (chunk order, then extraction order). */
  order: number;
  /** Where this source states it, e.g. ["p12", "p14–p15"]. */
  citations: string[];
  /** One entry per chain into the idea: the premises that jointly build it. */
  builtOn: IdeaRef[][];
  /** Ideas this one is a premise of. */
  leadsTo: IdeaRef[];
}

export interface DeltaSummary {
  sourceId: string;
  total: number;
  counts: Record<DeltaClass, number>;
  items: DeltaItem[];
  sentence: string;
}

export function deltaForSource(db: Database, sourceId: string): DeltaSummary {
  const view = loadKnowledge(db);
  const nodeIds = coveredNodeIds(db, sourceId).filter((id) => view.nodes.has(id));
  const targetDepths = new Map<string, Depth>(nodeIds.map((id) => [id, targetDepthFor(id, view.goals)]));
  const conflicts = new Set<string>();
  for (const chunk of listChunks(db, sourceId)) for (const k of chunk.conflicts) conflicts.add(k.nodeId);
  const delta = classifyDelta({ nodeIds, states: view.states, owned: view.owned, fringe: view.fringe, targetDepths, conflicts });
  const appearance = new Map<string, number>();
  for (const chunk of listChunks(db, sourceId)) for (const id of chunk.nodeIds) if (!appearance.has(id)) appearance.set(id, appearance.size);
  const ref = (id: string): IdeaRef => ({ id, name: view.nodes.get(id)?.name ?? id });
  const items: DeltaItem[] = nodeIds
    .map((id) => {
      const node = view.nodes.get(id);
      const state = view.states.get(id);
      return {
        nodeId: id,
        name: node?.name ?? id,
        kind: node?.kind ?? 'claim',
        statement: node?.statement ?? '',
        cls: delta.classes.get(id) ?? 'new-beyond',
        depth: state?.depth ?? 0,
        targetDepth: targetDepths.get(id) ?? 0,
        order: appearance.get(id) ?? Number.MAX_SAFE_INTEGER,
        citations: [...new Set((node?.sources ?? []).filter((r) => r.sourceId === sourceId && r.locator).map((r) => r.locator as string))],
        builtOn: (view.index.into.get(id) ?? []).map((chain) => chain.premises.map(ref)),
        leadsTo: [...new Set((view.index.outOf.get(id) ?? []).map((chain) => chain.conclusion))].map(ref),
      };
    })
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const c = delta.counts;
  const have = c.known + c.deeper;
  const haveText = have === 0 ? 'you have none yet' : `you have ${have}${c.deeper ? ` (${c.deeper} could go deeper)` : ''}`;
  const sentence = `Of ${nodeIds.length} ideas in this source, ${haveText}; ${c['new-fringe']} are new and learnable now; ${c['new-beyond']} need a prerequisite first${c.conflict ? `; ${c.conflict} conflict with what you know` : ''}.`;
  return { sourceId, total: nodeIds.length, counts: c, items, sentence };
}
