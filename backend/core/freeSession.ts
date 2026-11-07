/**
 * Sessions the learner chooses (design §4.5), pure: what a chosen set of ideas still needs that the
 * learner does not own, how deep each idea goes, and in what order they are taught.
 */
import { orderByDependencies } from './plan';
import type { PlanCandidate } from './plan';
import { OWNED_DEPTH } from './types';
import type { Depth } from './types';

/** A session holds at most this many ideas, as a planned one does. */
export const MAX_FREE_IDEAS = 6;

/** The premise sets of each idea: one per chain into it (any one set, owned, makes it learnable). */
export type PremiseSets = (id: string) => string[][];

export interface MissingPremise {
  /** The premise the learner does not own and the session does not teach. */
  id: string;
  /** The session's ideas that build on it, in session order. */
  neededBy: string[];
}

/**
 * For each chosen idea that no chain makes learnable (every chain has a premise neither owned nor in
 * the session), the premises of its nearest chain (the fewest missing) that are missing. Ideas with no
 * chains are starting points and need nothing. Gaps come in the order the session first needs them.
 */
export function missingPremises(session: string[], owned: ReadonlySet<string>, premiseSets: PremiseSets): MissingPremise[] {
  const inSession = new Set(session);
  const have = (id: string) => owned.has(id) || inSession.has(id);
  const gaps = new Map<string, string[]>();
  for (const id of session) {
    const sets = premiseSets(id);
    if (sets.length === 0 || sets.some((premises) => premises.every(have))) continue;
    const nearest = sets.map((premises) => premises.filter((p) => !have(p))).reduce((best, missing) => (missing.length < best.length ? missing : best));
    for (const p of nearest) gaps.set(p, [...(gaps.get(p) ?? []), id]);
  }
  return [...gaps.entries()].map(([id, neededBy]) => ({ id, neededBy }));
}

/**
 * How deep a chosen idea goes: what was asked (a goal's plan, the session maker's aim, or owning it),
 * and always past what the learner already has, since choosing an idea you know means going deeper.
 */
export function chosenAim(asked: number, fromDepth: number): Depth {
  return Math.min(5, Math.max(asked || OWNED_DEPTH, fromDepth + 1)) as Depth;
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Teach in dependency order: an idea after the chosen ideas it builds on, otherwise in the order given. */
export function teachingOrder(session: string[], premiseSets: PremiseSets): { order: string[]; dependsOn: Map<string, string[]> } {
  const inSession = new Set(session);
  const dependsOn = new Map(session.map((id) => [id, [...new Set(premiseSets(id).flat())].filter((p) => p !== id && inSession.has(p))]));
  const candidates = new Map<string, PlanCandidate>(session.map((id) => [id, { nodeId: id, layer: 0, dependsOn: dependsOn.get(id) ?? [], onFringe: false }]));
  return { order: orderByDependencies(session, candidates), dependsOn };
}
