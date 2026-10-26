/**
 * Chain dedupe and simplification (design §2.1). Only provable redundancy is removed.
 */
import type { Chain } from './types';
import { ancestors, indexChains } from './graph';

export function chainKey(premises: readonly string[], conclusion: string): string {
  return `${[...new Set(premises)].sort().join('+')}=>${conclusion}`;
}

/** Drop chains that repeat an earlier chain's (premises, conclusion); sources of duplicates are merged into the kept one. */
export function dedupeChains(chains: Chain[]): Chain[] {
  const byKey = new Map<string, Chain>();
  for (const chain of chains) {
    const key = chainKey(chain.premises, chain.conclusion);
    const existing = byKey.get(key);
    if (existing) {
      const seen = new Set(existing.sources.map((s) => `${s.sourceId}|${s.locator ?? ''}`));
      for (const s of chain.sources) {
        const k = `${s.sourceId}|${s.locator ?? ''}`;
        if (!seen.has(k)) {
          existing.sources.push(s);
          seen.add(k);
        }
      }
    } else {
      byKey.set(key, { ...chain, premises: [...new Set(chain.premises)], sources: [...chain.sources] });
    }
  }
  return [...byKey.values()];
}

export interface SimplifyResult {
  kept: Chain[];
  dropped: { chain: Chain; reason: 'subset' | 'covered' }[];
}

/**
 * For each conclusion: a chain is dropped when a kept chain for the same conclusion has a strict subset
 * of its premises, or when its premises are all covered by a kept chain's premises plus their transitive
 * ancestry. Chains are considered shortest first so the minimal argument is the one kept.
 */
export function simplifyChains(chains: Chain[]): SimplifyResult {
  const deduped = dedupeChains(chains);
  const index = indexChains(deduped);
  const kept: Chain[] = [];
  const dropped: SimplifyResult['dropped'] = [];
  const byConclusion = new Map<string, Chain[]>();
  for (const c of deduped) {
    const list = byConclusion.get(c.conclusion) ?? [];
    list.push(c);
    byConclusion.set(c.conclusion, list);
  }
  for (const group of byConclusion.values()) {
    group.sort((a, b) => a.premises.length - b.premises.length || a.id.localeCompare(b.id));
    const keptHere: Chain[] = [];
    for (const chain of group) {
      const premises = new Set(chain.premises);
      let reason: 'subset' | 'covered' | null = null;
      for (const k of keptHere) {
        if (k.premises.length < premises.size && k.premises.every((p) => premises.has(p))) {
          reason = 'subset';
          break;
        }
        const covered = new Set(k.premises);
        for (const p of k.premises) for (const a of ancestors(p, index)) covered.add(a);
        if (chain.premises.every((p) => covered.has(p))) {
          reason = 'covered';
          break;
        }
      }
      if (reason) dropped.push({ chain, reason });
      else keptHere.push(chain);
    }
    kept.push(...keptHere);
  }
  return { kept, dropped };
}
