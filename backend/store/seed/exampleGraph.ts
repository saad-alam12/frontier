/**
 * A small hand-written game theory graph for development and tests (about 35 nodes).
 * Written from scratch; standard textbook material.
 */
import { planMerge } from '../../core/merge';
import type { ExtractedChain, ExtractedNode } from '../../core/merge';
import type { Database } from '../db';
import { transaction } from '../db';
import { createSource, findSourceByHash, updateSourceStatus, addCoverage } from '../sources';
import { listNodes } from '../world';
import { applyMergePlan } from '../worldWrites';

type N = [tempId: string, kind: ExtractedNode['kind'], name: string, statement: string];

export const SEED_NODES: N[] = [
  ['game', 'term', 'Strategic game', 'A strategic game has a set of players, a set of strategies for each player, and payoffs for every combination of strategies.'],
  ['strategy', 'term', 'Strategy', 'A complete plan of action for a player: what to do in every situation the player may face.'],
  ['payoff', 'term', 'Payoff function', 'A function assigning each player a number for every strategy profile, representing how much they like the outcome.'],
  ['profile', 'term', 'Strategy profile', 'One strategy chosen for every player, written as a tuple.'],
  ['probability', 'term', 'Probability distribution', 'An assignment of non-negative weights summing to one over a set of outcomes.'],
  ['bestResponse', 'term', 'Best response', "A strategy that gives a player the highest payoff available, holding the other players' strategies fixed."],
  ['dominant', 'term', 'Strictly dominant strategy', 'A strategy that yields a strictly higher payoff than every other strategy, whatever the others do.'],
  ['dominated', 'term', 'Strictly dominated strategy', 'A strategy for which some other strategy yields a strictly higher payoff, whatever the others do.'],
  ['nash', 'term', 'Nash equilibrium', 'A strategy profile in which no player can gain by changing their own strategy alone.'],
  ['mixed', 'term', 'Mixed strategy', 'A probability distribution over a player\'s pure strategies.'],
  ['expectedUtility', 'term', 'Expected utility', 'The probability-weighted average of the payoffs of the possible outcomes.'],
  ['extensive', 'term', 'Extensive-form game', 'A game described as a tree of decision nodes with players moving in sequence and payoffs at the leaves.'],
  ['subgame', 'term', 'Subgame', 'A part of an extensive-form game that starts at a single decision node and contains everything that follows it.'],
  ['spe', 'term', 'Subgame perfect equilibrium', 'A strategy profile that is a Nash equilibrium in every subgame.'],
  ['pd', 'term', "Prisoner's dilemma", 'A two-player game where each player can cooperate or defect, defecting is dominant, and mutual cooperation beats mutual defection.'],
  ['ultimatum', 'term', 'Ultimatum game', 'A proposer offers a split of a sum; the responder accepts (both get the split) or rejects (both get nothing).'],
  ['zeroSum', 'term', 'Zero-sum game', "A two-player game where the players' payoffs always sum to zero."],
  ['coordination', 'term', 'Coordination game', 'A game in which players do best by choosing matching actions, with more than one way to match.'],
  ['iesds', 'procedure', 'Iterated elimination of strictly dominated strategies', 'Remove a strictly dominated strategy, then repeat on the reduced game until none remain.'],
  ['backwardInduction', 'procedure', 'Backward induction', 'Starting from the last decision nodes, pick the optimal move at each node given the moves chosen later, working back to the root.'],
  ['findBr', 'procedure', 'Find best responses from a payoff matrix', "For each strategy of the opponent, mark the own strategy with the highest payoff in that column or row."],
  ['findPureNash', 'procedure', 'Find pure Nash equilibria in a matrix', 'Mark every best response for both players; cells where both players\' choices are marked are the pure Nash equilibria.'],
  ['nashMutualBr', 'claim', 'Nash equilibrium is mutual best response', "A strategy profile is a Nash equilibrium if and only if every player's strategy is a best response to the others' strategies."],
  ['dominantNash', 'claim', 'Dominant strategies form the unique Nash equilibrium', 'If every player has a strictly dominant strategy, the profile of those strategies is the unique Nash equilibrium.'],
  ['dominatedNeverPlayed', 'claim', 'Dominated strategies are never played in equilibrium', 'A strictly dominated strategy is played with probability zero in every Nash equilibrium.'],
  ['iesdsPreservesNash', 'claim', 'IESDS preserves Nash equilibria', 'Iterated elimination of strictly dominated strategies never removes a Nash equilibrium of the original game.'],
  ['nashExistence', 'claim', 'Nash existence theorem', 'Every finite strategic game has at least one Nash equilibrium in mixed strategies.'],
  ['euLinear', 'claim', 'Expected utility is linear in own mixing', "A player's expected utility is linear in the probabilities of their own mixed strategy, for fixed strategies of the others."],
  ['mixedIndifference', 'claim', 'Indifference in mixed equilibrium', 'In a mixed-strategy Nash equilibrium each player is indifferent among all pure strategies they play with positive probability.'],
  ['pdUnique', 'claim', 'Defection is the unique equilibrium of the prisoner\'s dilemma', "In the prisoner's dilemma, mutual defection is the unique Nash equilibrium even though mutual cooperation pays both players more."],
  ['speIsNash', 'claim', 'Every SPE is a Nash equilibrium', 'A subgame perfect equilibrium is in particular a Nash equilibrium of the whole game, because the whole game is a subgame.'],
  ['biGivesSpe', 'claim', 'Backward induction yields an SPE', 'In a finite extensive-form game of perfect information, backward induction produces a subgame perfect equilibrium.'],
  ['speNoncredible', 'claim', 'SPE rules out non-credible threats', 'Subgame perfection removes Nash equilibria that rely on threats a player would not carry out when the moment came.'],
  ['ultimatumSpe', 'claim', 'Ultimatum game SPE', 'In the ultimatum game the unique subgame perfect equilibrium has the proposer offering the smallest positive amount and the responder accepting every positive offer.'],
  ['minimax', 'claim', 'Minimax theorem', 'In a two-player zero-sum game, every Nash equilibrium gives each player their maximin value, and such an equilibrium exists in mixed strategies.'],
  ['coordinationMultiple', 'claim', 'Coordination games have several equilibria', 'A coordination game has more than one pure Nash equilibrium, one for each way of matching.'],
];

export const SEED_CHAINS: [premises: string[], conclusion: string][] = [
  [['strategy'], 'profile'],
  [['strategy', 'payoff'], 'bestResponse'],
  [['strategy', 'payoff'], 'dominant'],
  [['strategy', 'payoff'], 'dominated'],
  [['profile', 'bestResponse'], 'nash'],
  [['strategy', 'probability'], 'mixed'],
  [['payoff', 'probability'], 'expectedUtility'],
  [['extensive'], 'subgame'],
  [['subgame', 'nash'], 'spe'],
  [['dominated'], 'iesds'],
  [['extensive'], 'backwardInduction'],
  [['bestResponse', 'payoff'], 'findBr'],
  [['findBr', 'nashMutualBr'], 'findPureNash'],
  [['nash', 'bestResponse'], 'nashMutualBr'],
  [['dominant', 'nashMutualBr'], 'dominantNash'],
  [['dominated', 'nashMutualBr'], 'dominatedNeverPlayed'],
  [['iesds', 'dominatedNeverPlayed'], 'iesdsPreservesNash'],
  [['mixed', 'nash', 'expectedUtility'], 'nashExistence'],
  [['expectedUtility', 'probability', 'mixed'], 'euLinear'],
  [['euLinear', 'nashMutualBr'], 'mixedIndifference'],
  [['dominantNash', 'pd'], 'pdUnique'],
  [['spe', 'subgame', 'nash'], 'speIsNash'],
  [['backwardInduction', 'spe', 'extensive'], 'biGivesSpe'],
  [['speIsNash', 'subgame'], 'speNoncredible'],
  [['biGivesSpe', 'ultimatum'], 'ultimatumSpe'],
  [['zeroSum', 'nashExistence'], 'minimax'],
  [['coordination', 'findPureNash'], 'coordinationMultiple'],
];

export const SEED_HASH = 'seed:example-graph:v1';

/** Load the seed graph through the merger. Returns tempId → node id. Safe to call twice. */
export function seedExampleGraph(db: Database): Map<string, string> {
  const existing = findSourceByHash(db, SEED_HASH);
  if (existing) {
    const byName = new Map(listNodes(db).map((n) => [n.name, n.id]));
    return new Map(SEED_NODES.map(([tempId, , name]) => [tempId, byName.get(name) as string]));
  }
  return transaction(db, () => {
    const source = createSource(db, { kind: 'markdown', title: 'Example graph (seed)', path: null, hash: SEED_HASH }, []);
    const extractedNodes: ExtractedNode[] = SEED_NODES.map(([tempId, kind, name, statement]) => ({ tempId, kind, name, statement, aliases: [], locator: 'seed' }));
    const extractedChains: ExtractedChain[] = SEED_CHAINS.map(([premises, conclusion]) => ({ premises, conclusion, locator: 'seed' }));
    let counter = 0;
    const plan = planMerge({
      sourceId: source.id,
      extractedNodes,
      extractedChains,
      identities: new Map(),
      existingNodes: new Map(),
      existingChains: [],
      newId: (prefix) => `${prefix}_seed_${String(++counter).padStart(3, '0')}`,
    });
    applyMergePlan(db, plan);
    addCoverage(db, source.id, plan.coveredNodeIds);
    updateSourceStatus(db, source.id, { status: 'done' });
    const ids = new Map<string, string>();
    plan.newNodes.forEach((n, i) => ids.set(SEED_NODES[i]?.[0] as string, n.id));
    return ids;
  });
}
