import { describe, expect, it } from 'vitest';
import { planIdeaEdit, planIdeaMerge } from '../core/ideaMerge';
import type { Chain, KnowledgeNode } from '../core/types';
import { openDatabase } from '../store/db';
import { listBugsForNode, recordBug } from '../store/bugs';
import { cardsForNodes } from '../store/cards';
import { getState, listEvidenceForNode } from '../store/evidence';
import { addCapabilities, createGoal, listTargets } from '../store/goals';
import { ideaNotesFor, saveIdeaNote } from '../store/ideaNotes';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { appendSessionEvent, createSession, endSession, listSessionEvents } from '../store/sessions';
import { createUnverifiedNodes, getNode, listChains } from '../store/world';
import { applyMergePlan } from '../store/world';
import { saveCard } from './cards';
import { recordEvidence } from './evidence';
import { refreshGoalFields } from './knowledge';
import { editIdea, mergeCandidates, mergeIdeas } from './mapEdit';

const node = (id: string, over: Partial<KnowledgeNode> = {}): KnowledgeNode => ({ id, kind: 'term', name: id.toUpperCase(), statement: `${id} says.`, aliases: [], sources: [], status: 'verified', ...over });
const chain = (id: string, premises: string[], conclusion: string): Chain => ({ id, premises, conclusion, sources: [{ sourceId: `src_${id}` }] });

describe('planning a merge', () => {
  it('rewrites chains onto the kept idea, joins repeats and drops loops and circles', () => {
    const keep = node('k', { aliases: ['kay'] });
    const drop = node('d', { name: 'Kay', aliases: ['dee'], sources: [{ sourceId: 's2', locator: 'p3' }], status: 'unverified' });
    const chains = [
      chain('c1', ['a'], 'k'),
      chain('c2', ['a'], 'd'), // the same as c1 once merged: its citation joins c1
      chain('c3', ['d', 'b'], 'x'), // uses the dropped idea: now uses the kept one
      chain('c4', ['k'], 'd'), // would lead from the idea to itself
      chain('c5', ['x'], 'y'),
      chain('c6', ['y'], 'd'), // y → k, but k already leads to y through c3, c5: a circle
    ];
    const plan = planIdeaMerge(keep, drop, chains);
    expect(plan.removeChainIds.sort()).toEqual(['c2', 'c3', 'c4', 'c6']);
    expect(plan.newChains).toEqual([{ id: 'c3', premises: ['k', 'b'], conclusion: 'x', sources: [{ sourceId: 'src_c3' }] }]);
    expect(plan.chainSourceUpdates).toEqual([{ chainId: 'c1', sources: [{ sourceId: 'src_c1' }, { sourceId: 'src_c2' }] }]);
    // a name joins once whatever its case (the kept idea's spelling stays), and never the kept name itself
    expect(plan.node.aliases).toEqual(['kay', 'dee']);
    expect(plan.node.sources).toEqual([{ sourceId: 's2', locator: 'p3' }]);
    expect(plan.node.verified).toBe(true);
  });

  it('keeps a renamed idea findable by its old name', () => {
    const n = node('n', { name: 'Nash eq', aliases: ['NE'] });
    expect(planIdeaEdit(n, { name: 'Nash equilibrium', statement: n.statement })).toEqual({ name: 'Nash equilibrium', statement: n.statement, aliases: ['NE', 'Nash eq'] });
    expect(planIdeaEdit(n, { name: 'nash EQ', statement: 'Better.' })?.aliases).toEqual(['NE']);
    expect(planIdeaEdit(n, { name: ' Nash eq ', statement: n.statement })).toBeNull();
    expect(() => planIdeaEdit(n, { name: ' ', statement: 'x' })).toThrow(/needs a name/);
  });
});

function setup() {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const id = (k: string) => ids.get(k) as string;
  // a duplicate of Nash equilibrium, as a second source might have made it
  createUnverifiedNodes(db, [{ id: 'node_dupnash001', kind: 'term', name: 'Nash equilibrium (NE)', statement: 'Nobody gains by deviating alone.', aliases: [] }]);
  applyMergePlan(db, {
    newNodes: [],
    nodeUpdates: [],
    newChains: [chain('chain_dup00001', [id('profile'), id('bestResponse')], 'node_dupnash001'), chain('chain_dup00002', ['node_dupnash001'], id('nashExistence'))],
    chainUpdates: [],
    droppedChainIds: [],
    coveredNodeIds: [],
    skippedChains: [],
    examples: [],
  } as Parameters<typeof applyMergePlan>[1]);
  const goal = createGoal(db, { text: 'Pass the game theory exam' });
  addCapabilities(db, goal.id, [{ statement: 'Can find Nash equilibria', targets: [{ nodeId: id('nash'), depth: 2 }, { nodeId: 'node_dupnash001', depth: 3, core: true }] }]);
  refreshGoalFields(db);
  return { db, id, goal, dup: 'node_dupnash001' };
}

describe('editing the map', () => {
  it('renames an idea and corrects its statement', () => {
    const { db, id } = setup();
    expect(editIdea(db, id('nash'), { name: 'Nash equilibrium (pure)', statement: 'No player gains by changing only their own strategy.' })).toEqual({ changed: true });
    const nash = getNode(db, id('nash'));
    expect(nash?.name).toBe('Nash equilibrium (pure)');
    expect(nash?.aliases).toContain('Nash equilibrium');
    expect(editIdea(db, id('nash'), { name: 'Nash equilibrium (pure)', statement: 'No player gains by changing only their own strategy.' })).toEqual({ changed: false });
    expect(() => editIdea(db, 'node_missing', { name: 'x', statement: 'y' })).toThrow(/no longer on your map/);
  });

  it('merges a duplicate: one idea with both names, its chains, evidence, targets, cards, notes and history', () => {
    const { db, id, goal, dup } = setup();
    const nash = id('nash');
    recordEvidence(db, { nodeId: dup, kind: 'explain', score: 0.9, reasoning: 'explained the duplicate' });
    const card = saveCard(db, { front: 'Define NE', back: 'No profitable deviation.', nodeIds: [dup] });
    recordBug(db, dup, 'thinks one player is enough');
    saveIdeaNote(db, nash, 'Mine on nash.');
    saveIdeaNote(db, dup, 'Mine on the duplicate.');
    const session = createSession(db, goal.id, { nodeStatus: { [dup]: 'done' } });
    appendSessionEvent(db, session.id, 'card', { nodeId: dup, stage: 'explain', card: { stage: 'explain', markdown: 'x' } });
    endSession(db, session.id, 'done');

    expect(mergeIdeas(db, nash, dup)).toEqual({ keepId: nash });

    expect(getNode(db, dup)).toBeUndefined();
    expect(getNode(db, nash)?.aliases).toContain('Nash equilibrium (NE)');
    expect(getNode(db, nash)?.status).toBe('verified');
    // the duplicate's chain into it was the same as nash's own; its chain out of it now starts at nash
    const chains = listChains(db);
    expect(chains.filter((c) => c.conclusion === nash && c.premises.includes(id('profile')))).toHaveLength(1);
    expect(chains.some((c) => c.premises.includes(nash) && c.conclusion === id('nashExistence'))).toBe(true);
    expect(chains.some((c) => c.premises.includes(dup) || c.conclusion === dup)).toBe(false);
    // what the learner showed about the duplicate counts for nash
    expect(listEvidenceForNode(db, nash).some((e) => e.reasoning === 'explained the duplicate')).toBe(true);
    expect(getState(db, nash)?.depth).toBeGreaterThan(0);
    // one target, the deeper depth, core
    const targets = listTargets(db, goal.id).filter((t) => t.nodeId === nash);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.idealDepth).toBe(3);
    expect(targets[0]?.core).toBe(true);
    expect(cardsForNodes(db, [nash]).map((c) => c.id)).toContain(card.id);
    expect(listBugsForNode(db, nash).map((b) => b.description)).toContain('thinks one player is enough');
    expect(ideaNotesFor(db, [nash]).get(nash)).toBe('Mine on nash.\n\nMine on the duplicate.');
    expect(listSessionEvents(db, session.id)[0]?.payload.nodeId).toBe(nash);
  });

  it('refuses while an open session uses one of them, and merging an idea with itself', () => {
    const { db, id, goal, dup } = setup();
    createSession(db, goal.id, { nodeStatus: { [dup]: 'active' } });
    expect(() => mergeIdeas(db, id('nash'), dup)).toThrow(/session that is open/);
    expect(() => mergeIdeas(db, id('nash'), id('nash'))).toThrow(/with itself/);
  });

  it('offers ideas that match what the learner typed', () => {
    const { db, id, dup } = setup();
    expect(mergeCandidates(db, id('nash'), 'Nash equilibrium').map((c) => c.id)).toContain(dup);
    expect(mergeCandidates(db, id('nash'), 'Nash equilibrium').map((c) => c.id)).not.toContain(id('nash'));
  });
});
