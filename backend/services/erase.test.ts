import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeEmbedder, textHash } from '../ingest/embedder';
import { openDatabase } from '../store/db';
import { countEmbeddings, upsertEmbedding } from '../store/embeddings';
import { countEvidence, getState, listEvidenceForNode } from '../store/evidence';
import { addCapabilities, createGoal, getGoal, listCapabilities, listMaterials, listTargets, markCompiled, setMaterials } from '../store/goals';
import { createPracticeSet, getPracticeSet } from '../store/practice';
import { appendSessionEvent, createSession, endSession } from '../store/sessions';
import { getSetting, setSetting } from '../store/settingsTable';
import { seedExampleGraph, SEED_HASH } from '../store/seed/exampleGraph';
import { addCoverage, createSource, findSourceByHash, getSource, listSources } from '../store/sources';
import { chainsAround, countNodes, getNode, listChains, listNodes } from '../store/world';
import { applyMergePlan } from '../store/worldWrites';
import { eraseFromMap, EraseRequestSchema, previewErase } from './erase';
import type { EraseRequest } from './erase';
import { recordEvidence } from './evidence';
import { embeddingText } from './ingestion';
import { refreshGoalFields } from './knowledge';
import { mapView } from './map';
import { trail } from './trails';

async function setup() {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const id = (k: string) => ids.get(k) as string;
  const embedder = new FakeEmbedder();
  const nodes = listNodes(db);
  const vectors = await embedder.embed(nodes.map(embeddingText));
  nodes.forEach((n, i) => upsertEmbedding(db, { nodeId: n.id, model: embedder.model, vector: vectors[i] as Float32Array, textHash: textHash(embeddingText(n)) }));
  const sourcesDir = mkdtempSync(join(tmpdir(), 'frontier-erase-'));
  const erase = (request: EraseRequest) => eraseFromMap({ db, sourcesDir }, request);
  return { db, id, sourcesDir, erase };
}

/** A second source that also covers (and cites) some seed ideas, with a stored file copy. */
function addSharedSource(db: ReturnType<typeof openDatabase>, sourcesDir: string, nodeIds: string[]) {
  const source = createSource(db, { kind: 'markdown', title: 'Notes', path: 'abc123-notes.md', hash: 'notes-hash' }, [{ text: 'notes', locator: 'p1' }]);
  writeFileSync(join(sourcesDir, 'abc123-notes.md'), 'notes');
  addCoverage(db, source.id, nodeIds);
  applyMergePlan(db, {
    newNodes: [],
    nodeUpdates: nodeIds.map((nodeId) => ({ nodeId, aliases: [], sources: [{ sourceId: source.id, locator: 'p1' }] })),
    newChains: [],
    chainUpdates: [],
    droppedChainIds: [],
    coveredNodeIds: nodeIds,
    skippedChains: [],
    examples: [],
  });
  return source;
}

describe('erase service', () => {
  it('previews without changing anything, and the preview matches what is erased', async () => {
    const { db, id, erase } = await setup();
    recordEvidence(db, { nodeId: id('nash'), kind: 'explain', score: 0.9, reasoning: 't' });
    const request: EraseRequest = { scope: 'ideas', ids: [id('nash'), id('strategy')] };
    const before = { nodes: countNodes(db), chains: listChains(db).length, evidence: countEvidence(db) };
    const preview = previewErase(db, request);
    const touching = new Set([...chainsAround(db, id('nash')), ...chainsAround(db, id('strategy'))].map((c) => c.id));
    expect(preview).toEqual({ ideas: 2, links: touching.size, learned: 1, sources: 0, cards: 0 });
    expect({ nodes: countNodes(db), chains: listChains(db).length, evidence: countEvidence(db) }).toEqual(before);
    const result = erase(request);
    expect({ ideas: result.ideas, links: result.links, learned: result.learned, sources: result.sources, cards: result.cards }).toEqual(preview);
    expect(countNodes(db)).toBe(before.nodes - 2);
    expect(listChains(db).length).toBe(before.chains - touching.size);
  });

  it('erases a single idea with its links, evidence, embedding and goal targets; the rest stays', async () => {
    const { db, id, erase } = await setup();
    const nash = id('nash');
    recordEvidence(db, { nodeId: nash, kind: 'explain', score: 0.9, reasoning: 't' });
    recordEvidence(db, { nodeId: id('payoff'), kind: 'explain', score: 0.9, reasoning: 't' });
    const goal = createGoal(db, 'Exam');
    addCapabilities(db, goal.id, [
      { statement: 'Can find equilibria', targets: [{ nodeId: nash, depth: 3 }, { nodeId: id('bestResponse'), depth: 2 }] },
      { statement: 'Knows Nash', targets: [{ nodeId: nash, depth: 2 }] },
    ]);
    markCompiled(db, goal.id, 'Exam', []);
    refreshGoalFields(db);
    const embeddings = countEmbeddings(db);

    const result = erase({ scope: 'ideas', ids: [nash] });

    expect(result.ideas).toBe(1);
    expect(getNode(db, nash)).toBeUndefined();
    expect(chainsAround(db, nash)).toEqual([]);
    expect(listEvidenceForNode(db, nash)).toEqual([]);
    expect(getState(db, nash)).toBeUndefined();
    expect(countEmbeddings(db)).toBe(embeddings - 1);
    expect(listEvidenceForNode(db, id('payoff'))).toHaveLength(1);
    // the capability left with no ideas goes; the goal keeps the other and stays mapped
    expect(listTargets(db, goal.id, { all: true }).map((t) => t.nodeId)).toEqual([id('bestResponse')]);
    expect(listCapabilities(db, goal.id).map((c) => c.statement)).toEqual(['Can find equilibria']);
    expect(getGoal(db, goal.id)?.compiledAt).not.toBeNull();
    expect(result.goalsToMap).toEqual([]);
  });

  it('resets a goal left with no capabilities so it is mapped again', async () => {
    const { db, id, erase } = await setup();
    const goal = createGoal(db, 'Only Nash');
    addCapabilities(db, goal.id, [{ statement: 'Knows Nash', targets: [{ nodeId: id('nash'), depth: 2 }] }]);
    markCompiled(db, goal.id, 'Only Nash', []);
    const result = erase({ scope: 'ideas', ids: [id('nash')] });
    expect(result.goalsToMap).toEqual([goal.id]);
    expect(getGoal(db, goal.id)?.compiledAt).toBeNull();
    expect(listCapabilities(db, goal.id)).toEqual([]);
  });

  it('erases every idea in a topic, as the map groups them', async () => {
    const { db, erase } = await setup();
    const map = mapView(db);
    const topic = map.topics[0];
    if (!topic) throw new Error('the seed graph has topics');
    const members = map.nodes.filter((n) => n.topic === topic.id).map((n) => n.id);
    expect(previewErase(db, { scope: 'topics', ids: [topic.id] }).ideas).toBe(topic.size);
    erase({ scope: 'topics', ids: [topic.id] });
    for (const nodeId of members) expect(getNode(db, nodeId)).toBeUndefined();
    expect(countNodes(db)).toBe(map.nodes.length - members.length);
  });

  it('erases a source and the ideas only it gave; shared ideas stay and lose only their link to it', async () => {
    const { db, id, sourcesDir, erase } = await setup();
    const seed = findSourceByHash(db, SEED_HASH);
    if (!seed) throw new Error('seeded');
    const shared = [id('nash'), id('strategy')];
    const notes = addSharedSource(db, sourcesDir, shared);
    const goal = createGoal(db, 'Exam');
    setMaterials(db, goal.id, [
      { sourceId: seed.id, role: 'teaching' },
      { sourceId: notes.id, role: 'teaching' },
    ]);

    const preview = previewErase(db, { scope: 'sources', ids: [seed.id] });
    expect(preview.ideas).toBe(countNodes(db) - 2);
    expect(preview.sources).toBe(1);
    erase({ scope: 'sources', ids: [seed.id] });

    expect(getSource(db, seed.id)).toBeUndefined();
    expect(listNodes(db).map((n) => n.id).sort()).toEqual([...shared].sort());
    for (const nodeId of shared) expect(getNode(db, nodeId)?.sources.map((s) => s.sourceId)).toEqual([notes.id]);
    expect(listMaterials(db, goal.id).map((m) => m.sourceId)).toEqual([notes.id]);
    // the other source's stored file is untouched
    expect(existsSync(join(sourcesDir, 'abc123-notes.md'))).toBe(true);
  });

  it('deletes the stored file of an erased source', async () => {
    const { db, id, sourcesDir, erase } = await setup();
    const notes = addSharedSource(db, sourcesDir, [id('nash')]);
    const result = erase({ scope: 'sources', ids: [notes.id] });
    // nash is also in the seed source, so no idea goes
    expect(result.ideas).toBe(0);
    expect(getNode(db, id('nash'))?.sources.map((s) => s.sourceId)).not.toContain(notes.id);
    expect(existsSync(join(sourcesDir, 'abc123-notes.md'))).toBe(false);
  });

  it('erases the whole map; goals stay, marked to be mapped again; settings are untouched', async () => {
    const { db, id, sourcesDir, erase } = await setup();
    addSharedSource(db, sourcesDir, [id('nash')]);
    recordEvidence(db, { nodeId: id('nash'), kind: 'explain', score: 0.9, reasoning: 't' });
    setSetting(db, 'map.view', '{"colorBy":"topic"}');
    const goal = createGoal(db, 'Exam');
    addCapabilities(db, goal.id, [{ statement: 'Can find equilibria', targets: [{ nodeId: id('nash'), depth: 3 }] }]);
    markCompiled(db, goal.id, 'Exam', []);
    const total = countNodes(db);

    const result = erase({ scope: 'everything' });

    expect(result).toMatchObject({ ideas: total, learned: 1, sources: 2, goalsToMap: [goal.id] });
    expect(countNodes(db)).toBe(0);
    expect(listChains(db)).toEqual([]);
    expect(countEvidence(db)).toBe(0);
    expect(countEmbeddings(db)).toBe(0);
    expect(listSources(db)).toEqual([]);
    expect(existsSync(join(sourcesDir, 'abc123-notes.md'))).toBe(false);
    const after = getGoal(db, goal.id);
    expect(after?.text).toBe('Exam');
    expect(after?.compiledAt).toBeNull();
    expect(listCapabilities(db, goal.id)).toEqual([]);
    expect(getSetting(db, 'map.view')).toBe('{"colorBy":"topic"}');
  });

  it('closes open practice that asks about an erased idea, and past trails still read', async () => {
    const { db, id, erase } = await setup();
    const nash = id('nash');
    const set = createPracticeSet(db, {
      kind: 'compound',
      goalId: null,
      sessionId: null,
      problems: [{ nodeIds: [nash], rung: 1, cue: 0, presentation: 'theory', statement: 'Find the equilibrium.', solution: 'Both defect.', rubric: [], code: null }],
    });
    const session = createSession(db, null, { plan: { title: 'Equilibria', orientation: '', steps: [{ nodeId: nash, name: 'Nash equilibrium' }] }, nodeStatus: { [nash]: 'done' } });
    appendSessionEvent(db, session.id, 'node-done', { nodeId: nash });
    endSession(db, session.id, 'done');

    erase({ scope: 'ideas', ids: [nash] });

    expect(getPracticeSet(db, set.id)?.status).toBe('done');
    const replay = trail(db, session.id);
    expect(replay.items).toContainEqual(expect.objectContaining({ type: 'idea-done', idea: 'Nash equilibrium' }));
  });

  it('refuses while a session is open, and validates requests', async () => {
    const { db, id, erase } = await setup();
    createSession(db, null, {});
    expect(() => erase({ scope: 'ideas', ids: [id('nash')] })).toThrow(/open session/);
    expect(getNode(db, id('nash'))).toBeDefined();
    expect(EraseRequestSchema.safeParse({ scope: 'ideas', ids: [] }).success).toBe(false);
    expect(EraseRequestSchema.safeParse({ scope: 'everything' }).success).toBe(true);
  });
});
