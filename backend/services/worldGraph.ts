/**
 * The map itself, read once per graph: nodes, chains, their index and each idea's centrality. Only the
 * merger changes nodes and chains, and each of its writes says so (`worldChanged`), so this is kept
 * across answers, reviews and study time and read again only after the map changes (D23).
 */
import { indexChains } from '../core/graph';
import type { GraphIndex } from '../core/graph';
import { centrality } from '../core/leverage';
import type { Chain, KnowledgeNode } from '../core/types';
import type { Database } from '../store/db';
import { cachedForWorld } from '../store/readCache';
import { listChains, listNodes } from '../store/world';

/** Nodes, chains and what is derived from them alone. */
export interface WorldGraph {
  nodes: Map<string, KnowledgeNode>;
  chains: Chain[];
  index: GraphIndex;
  centrality: (nodeId: string) => number;
}

export function worldGraph(db: Database): WorldGraph {
  return cachedForWorld(db, 'graph', () => {
    const chains = listChains(db);
    const index = indexChains(chains);
    const known = new Map<string, number>();
    const centralityOf = (nodeId: string) => {
      let value = known.get(nodeId);
      if (value === undefined) {
        value = centrality(nodeId, index);
        known.set(nodeId, value);
      }
      return value;
    };
    return { nodes: new Map(listNodes(db).map((n) => [n.id, n])), chains, index, centrality: centralityOf };
  });
}
