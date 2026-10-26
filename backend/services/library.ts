/** Read models for the Library screen: sources with chunk progress, and the delta view per source. */
import { classifyDelta } from '../core/delta';
import type { DeltaClass } from '../core/delta';
import type { Depth, Source } from '../core/types';
import type { Database } from '../store/db';
import { coveredNodeIds, listChunks, listSources } from '../store/sources';
import type { SourceChunk } from '../store/sources';
import { loadKnowledge } from './knowledge';
import { targetDepthFor } from '../core/leverage';

export interface SourceSummary extends Source {
  chunks: { idx: number; locator: string; status: SourceChunk['status']; error: string | null; nodeCount: number }[];
  nodeCount: number;
}

export function listSourceSummaries(db: Database): SourceSummary[] {
  return listSources(db).map((s) => {
    const chunks = listChunks(db, s.id);
    return {
      ...s,
      nodeCount: coveredNodeIds(db, s.id).length,
      chunks: chunks.map((c) => ({ idx: c.idx, locator: c.locator, status: c.status, error: c.error, nodeCount: c.nodeIds.length })),
    };
  });
}

export interface DeltaItem {
  nodeId: string;
  name: string;
  kind: string;
  statement: string;
  cls: DeltaClass;
  depth: Depth;
  targetDepth: Depth;
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
  const order: DeltaClass[] = ['new-fringe', 'new-beyond', 'deeper', 'known', 'conflict'];
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
      };
    })
    .sort((a, b) => order.indexOf(a.cls) - order.indexOf(b.cls) || a.name.localeCompare(b.name));
  const c = delta.counts;
  const have = c.known + c.deeper;
  const sentence = `Of ${nodeIds.length} ideas in this source, ${have} you have${c.deeper ? ` (${c.deeper} could go deeper)` : ''}; ${c['new-fringe']} are new and learnable now; ${c['new-beyond']} need a prerequisite first${c.conflict ? `; ${c.conflict} conflict with what you know` : ''}.`;
  return { sourceId, total: nodeIds.length, counts: c, items, sentence };
}
