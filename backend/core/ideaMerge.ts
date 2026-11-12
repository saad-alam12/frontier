/**
 * Editing the map by hand (design §8, "Editing the map"), pure: what merging one idea into another
 * does to the world layer. The kept idea takes the other's name as another name, its citations and
 * every chain it was in; a chain that would now lead from an idea to itself, or round in a circle, is
 * dropped, and two chains that become the same are one. The store applies the plan (merger-owned).
 */
import { chainKey } from './chains';
import { ancestors, indexChains } from './graph';
import type { Chain, KnowledgeNode, SourceRef } from './types';

export interface IdeaMergePlan {
  keepId: string;
  dropId: string;
  /** The kept idea afterwards: the other's name and names join its own; their citations join. */
  node: { aliases: string[]; sources: SourceRef[]; verified: boolean };
  /** Every chain the dropped idea was in: removed, and written again as `newChains` where they survive. */
  removeChainIds: string[];
  newChains: Chain[];
  /** Existing chains a rewritten chain turned out to repeat: they take its citations. */
  chainSourceUpdates: { chainId: string; sources: SourceRef[] }[];
}

/** Merge `drop` into `keep`. */
export function planIdeaMerge(keep: KnowledgeNode, drop: KnowledgeNode, chains: Chain[]): IdeaMergePlan {
  if (keep.id === drop.id) throw new Error('An idea cannot be merged with itself.');
  const swap = (id: string) => (id === drop.id ? keep.id : id);
  const touched = chains.filter((c) => c.conclusion === drop.id || c.premises.includes(drop.id));
  const kept = chains.filter((c) => !touched.includes(c));
  const byKey = new Map(kept.map((c) => [chainKey(c.premises, c.conclusion), c]));
  const updates = new Map<string, SourceRef[]>();
  const rewritten = new Map<string, Chain>();
  for (const chain of touched) {
    const premises = [...new Set(chain.premises.map(swap))];
    const conclusion = swap(chain.conclusion);
    if (premises.includes(conclusion)) continue;
    const key = chainKey(premises, conclusion);
    const same = byKey.get(key);
    if (same) {
      updates.set(same.id, mergeRefs(updates.get(same.id) ?? same.sources, chain.sources));
      continue;
    }
    const earlier = rewritten.get(key);
    if (earlier) earlier.sources = mergeRefs(earlier.sources, chain.sources);
    else rewritten.set(key, { id: chain.id, premises, conclusion, sources: [...chain.sources] });
  }
  // a rewritten chain whose conclusion is already behind one of its premises would close a circle:
  // taken one at a time, in order, so only the chain that closes it is dropped
  const newChains: Chain[] = [];
  for (const candidate of rewritten.values()) {
    const index = indexChains([...kept, ...newChains, candidate]);
    if (!candidate.premises.some((p) => ancestors(p, index).has(candidate.conclusion))) newChains.push(candidate);
  }
  // the kept idea's names keep their spelling; the other's join after them, each name once whatever its case
  const names = new Map<string, string>();
  for (const n of [...keep.aliases, drop.name, ...drop.aliases].map((a) => a.trim())) {
    const key = n.toLowerCase();
    if (n && key !== keep.name.trim().toLowerCase() && !names.has(key)) names.set(key, n);
  }
  return {
    keepId: keep.id,
    dropId: drop.id,
    node: {
      aliases: [...names.values()],
      sources: mergeRefs(keep.sources, drop.sources),
      verified: keep.status === 'verified' || drop.status === 'verified',
    },
    removeChainIds: touched.map((c) => c.id),
    newChains,
    chainSourceUpdates: [...updates].map(([chainId, sources]) => ({ chainId, sources })),
  };
}

/** A hand edit of an idea's name or statement: the old name stays as another name, so sources still match it. */
export function planIdeaEdit(node: KnowledgeNode, edit: { name: string; statement: string }): { name: string; statement: string; aliases: string[] } | null {
  const name = edit.name.trim();
  const statement = edit.statement.trim();
  if (!name) throw new Error('An idea needs a name.');
  if (!statement) throw new Error('An idea needs a statement.');
  if (name === node.name && statement === node.statement) return null;
  const renamed = name.toLowerCase() !== node.name.trim().toLowerCase();
  const aliases = renamed ? [...node.aliases, node.name].filter((a, i, all) => a.trim().toLowerCase() !== name.toLowerCase() && all.findIndex((b) => b.toLowerCase() === a.toLowerCase()) === i) : node.aliases;
  return { name, statement, aliases };
}

function mergeRefs(a: SourceRef[], b: SourceRef[]): SourceRef[] {
  const seen = new Set(a.map((s) => `${s.sourceId}|${s.locator ?? ''}`));
  return [...a, ...b.filter((s) => !seen.has(`${s.sourceId}|${s.locator ?? ''}`) && seen.add(`${s.sourceId}|${s.locator ?? ''}`))];
}
