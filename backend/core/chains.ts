/**
 * Chain dedupe and simplification (design §2.1). Only provable redundancy is removed.
 */
import type { Chain } from './types';

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
  dropped: { chain: Chain; reason: 'subset' }[];
}

/**
 * For each conclusion: a chain is dropped when a kept chain for the same conclusion needs a strict
 * subset of its premises ("fractions and algebra lead to percentages" says nothing once "fractions
 * lead to percentages" is there). Chains are considered shortest first, so the minimal argument is
 * the one kept. Nothing else is redundant: a route that runs through ideas another route is built on
 * is still a route of its own, and dropping it would hide an idea from a learner who could learn it now.
 */
export function simplifyChains(chains: Chain[]): SimplifyResult {
  const deduped = dedupeChains(chains);
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
      if (keptHere.some((k) => k.premises.length < premises.size && k.premises.every((p) => premises.has(p)))) dropped.push({ chain, reason: 'subset' });
      else keptHere.push(chain);
    }
    kept.push(...keptHere);
  }
  return { kept, dropped };
}
