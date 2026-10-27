/**
 * The merger's planning step (design §7.4), pure: given what the extractor produced, the matcher's
 * identity decisions and the current world layer, compute exactly what to write. The store applies
 * the plan in one transaction; it is the only writer of the world layer.
 */
import { chainKey, simplifyChains } from './chains';
import type { Chain, KnowledgeNode, NodeKind, SourceRef, WorkedExample } from './types';

export interface ExtractedNode {
  /** Temporary id used within this extraction, e.g. "n3". */
  tempId: string;
  kind: NodeKind;
  name: string;
  statement: string;
  aliases: string[];
  locator?: string;
}

export interface ExtractedChain {
  /** Temp ids or existing node ids. */
  premises: string[];
  conclusion: string;
  locator?: string;
}

export interface ExtractedExample {
  /** Temp id or existing node id of the idea it illustrates. */
  illustrates: string;
  title: string;
  body: string;
  locator?: string;
}

export interface MergeInput {
  sourceId: string;
  extractedNodes: ExtractedNode[];
  extractedChains: ExtractedChain[];
  extractedExamples?: ExtractedExample[];
  /** tempId → existing node id when the matcher judged them the same claim. */
  identities: Map<string, string>;
  existingNodes: Map<string, KnowledgeNode>;
  existingChains: Chain[];
  newId: (prefix: 'node' | 'chain' | 'example') => string;
}

export interface MergePlan {
  newNodes: KnowledgeNode[];
  /** Existing nodes that gain aliases or citations. */
  nodeUpdates: { nodeId: string; aliases: string[]; sources: SourceRef[] }[];
  newChains: Chain[];
  /** Existing chains that gain a citation. */
  chainUpdates: { chainId: string; sources: SourceRef[] }[];
  /** Chains (new or existing) removed by simplification. */
  droppedChainIds: string[];
  /** Every node id this source touched, for coverage. */
  coveredNodeIds: string[];
  /** Chains that referenced an unknown id and were skipped. */
  skippedChains: { chain: ExtractedChain; reason: string }[];
  /** Worked examples resolved to the node they illustrate. */
  examples: WorkedExample[];
}

export function planMerge(input: MergeInput): MergePlan {
  const resolve = new Map<string, string>();
  const newNodes: KnowledgeNode[] = [];
  const nodeUpdates: MergePlan['nodeUpdates'] = [];
  const covered = new Set<string>();

  for (const n of input.extractedNodes) {
    const ref: SourceRef = { sourceId: input.sourceId, locator: n.locator };
    const existingId = input.identities.get(n.tempId);
    if (existingId && input.existingNodes.has(existingId)) {
      resolve.set(n.tempId, existingId);
      covered.add(existingId);
      const existing = input.existingNodes.get(existingId) as KnowledgeNode;
      const known = new Set([existing.name.toLowerCase(), ...existing.aliases.map((a) => a.toLowerCase())]);
      const aliases = [n.name, ...n.aliases].filter((a) => {
        const key = a.toLowerCase();
        if (known.has(key)) return false;
        known.add(key);
        return true;
      });
      const hasRef = existing.sources.some((s) => s.sourceId === ref.sourceId && (s.locator ?? '') === (ref.locator ?? ''));
      if (aliases.length || !hasRef) nodeUpdates.push({ nodeId: existingId, aliases, sources: hasRef ? [] : [ref] });
      continue;
    }
    const id = input.newId('node');
    resolve.set(n.tempId, id);
    covered.add(id);
    newNodes.push({ id, kind: n.kind, name: n.name, statement: n.statement, aliases: [...n.aliases], sources: [ref], status: 'verified' });
  }

  const resolveId = (id: string): string | null => resolve.get(id) ?? (input.existingNodes.has(id) ? id : null);
  const existingKeys = new Map(input.existingChains.map((c) => [chainKey(c.premises, c.conclusion), c]));
  const candidateChains: Chain[] = [];
  const chainUpdates: MergePlan['chainUpdates'] = [];
  const skippedChains: MergePlan['skippedChains'] = [];
  const seenNew = new Set<string>();

  for (const c of input.extractedChains) {
    const premises = c.premises.map(resolveId);
    const conclusion = resolveId(c.conclusion);
    if (conclusion === null || premises.some((p) => p === null)) {
      skippedChains.push({ chain: c, reason: 'references an unknown node id' });
      continue;
    }
    const resolvedPremises = [...new Set(premises as string[])].filter((p) => p !== conclusion);
    if (resolvedPremises.length === 0) {
      skippedChains.push({ chain: c, reason: 'no premises after resolving ids' });
      continue;
    }
    const ref: SourceRef = { sourceId: input.sourceId, locator: c.locator };
    const key = chainKey(resolvedPremises, conclusion);
    const existing = existingKeys.get(key);
    if (existing) {
      const hasRef = existing.sources.some((s) => s.sourceId === ref.sourceId && (s.locator ?? '') === (ref.locator ?? ''));
      if (!hasRef) chainUpdates.push({ chainId: existing.id, sources: [ref] });
      continue;
    }
    if (seenNew.has(key)) continue;
    seenNew.add(key);
    candidateChains.push({ id: input.newId('chain'), premises: resolvedPremises, conclusion, sources: [ref] });
  }

  // Simplify over the union so a new shorter chain can retire an existing longer one and vice versa.
  const { kept, dropped } = simplifyChains([...input.existingChains, ...candidateChains]);
  const keptIds = new Set(kept.map((c) => c.id));
  const newChains = candidateChains.filter((c) => keptIds.has(c.id));
  const droppedChainIds = dropped.map((d) => d.chain.id);

  const examples: WorkedExample[] = [];
  for (const e of input.extractedExamples ?? []) {
    const nodeId = resolveId(e.illustrates);
    if (nodeId) examples.push({ id: input.newId('example'), nodeId, sourceId: input.sourceId, locator: e.locator ?? '', title: e.title, body: e.body });
  }

  return {
    newNodes,
    nodeUpdates,
    newChains,
    chainUpdates: chainUpdates.filter((u) => keptIds.has(u.chainId)),
    droppedChainIds,
    coveredNodeIds: [...covered],
    skippedChains,
    examples,
  };
}
