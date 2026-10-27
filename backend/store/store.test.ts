import { describe, expect, it } from 'vitest';
import { openDatabase, transaction } from './db';
import { SCHEMA_VERSION } from './migrations';
import { seedExampleGraph, SEED_CHAINS, SEED_NODES } from './seed/exampleGraph';
import { chainsAround, countNodes, getNode, listChains, searchNodesByName } from './world';
import { createGoal, listGoals, listTargets, addCapabilities } from './goals';
import { getState, listEvidenceForNode } from './evidence';
import { recordEvidence, setOwnStatement } from '../services/evidence';
import { loadKnowledge, refreshGoalFields } from '../services/knowledge';
import { recordBug, listBugsForNode, resolveBug } from './bugs';
import { appendSessionEvent, createSession, activeSession, listSessionEvents, saveSessionState, endSession } from './sessions';
import { listEmbeddings, upsertEmbedding } from './embeddings';
import { newId } from './ids';

describe('database', () => {
  it('is created from scratch by migrations', () => {
    const db = openDatabase(':memory:');
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    expect(version).toBe(SCHEMA_VERSION);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    for (const t of ['nodes', 'chains', 'sources', 'node_states', 'evidence', 'bugs', 'goals', 'capabilities', 'targets', 'sessions', 'session_events', 'practice_sets', 'problems', 'answers', 'settings']) {
      expect(tables).toContain(t);
    }
  });

  it('rolls back nested transactions on error', () => {
    const db = openDatabase(':memory:');
    expect(() =>
      transaction(db, () => {
        seedExampleGraph(db);
        transaction(db, () => {
          throw new Error('boom');
        });
      }),
    ).toThrow('boom');
    expect(countNodes(db)).toBe(0);
  });
});

describe('seed graph', () => {
  it('loads once and is idempotent', () => {
    const db = openDatabase(':memory:');
    const ids = seedExampleGraph(db);
    expect(countNodes(db)).toBe(SEED_NODES.length);
    expect(listChains(db)).toHaveLength(SEED_CHAINS.length);
    const again = seedExampleGraph(db);
    expect(countNodes(db)).toBe(SEED_NODES.length);
    expect(again.get('nash')).toBe(ids.get('nash'));
    const nash = getNode(db, ids.get('nash') as string);
    expect(nash?.name).toBe('Nash equilibrium');
    expect(chainsAround(db, nash?.id as string).length).toBeGreaterThan(3);
    expect(searchNodesByName(db, 'nash equi')[0]?.id).toBe(nash?.id);
  });

  it('has the expected fringe once the root terms are owned', () => {
    const db = openDatabase(':memory:');
    const ids = seedExampleGraph(db);
    const now = new Date();
    const own = (key: string) => recordEvidence(db, { nodeId: ids.get(key) as string, kind: 'explain', score: 0.9, reasoning: 'test', at: now.toISOString() });
    for (const key of ['strategy', 'payoff']) own(key);
    const view = loadKnowledge(db, now);
    expect(view.owned.size).toBe(2);
    const fringeKeys = [...view.fringe].map((id) => [...ids].find(([, v]) => v === id)?.[0]).sort();
    // unlocked by the owned terms, plus every unowned root (learnable now with no premises)
    expect(fringeKeys).toEqual(['bestResponse', 'coordination', 'dominant', 'dominated', 'extensive', 'game', 'pd', 'probability', 'profile', 'ultimatum', 'zeroSum']);
  });
});

describe('evidence service', () => {
  it('appends evidence, derives state, and pays implicit credit to premises', () => {
    const db = openDatabase(':memory:');
    const ids = seedExampleGraph(db);
    const target = ids.get('dominantNash') as string;
    const { evidence, implicit } = recordEvidence(db, { nodeId: target, kind: 'use', score: 0.85, reasoning: 'applied it', sessionId: 's1' });
    expect(evidence.score).toBe(0.85);
    const premiseIds = implicit.map((e) => e.nodeId).sort();
    expect(premiseIds).toEqual(
      ['dominant', 'nashMutualBr', 'strategy', 'payoff', 'nash', 'bestResponse'].map((k) => ids.get(k)).sort(),
    );
    const oneHop = implicit.find((e) => e.nodeId === ids.get('dominant'));
    const twoHop = implicit.find((e) => e.nodeId === ids.get('nash'));
    expect(oneHop?.context.implicit?.weight).toBe(0.5);
    expect(twoHop?.context.implicit?.weight).toBe(0.25);
    expect(getState(db, target)?.depth).toBe(4);
    expect(getState(db, target)?.firstSessionId).toBe('s1');
    const premiseState = getState(db, ids.get('dominant') as string);
    expect(premiseState?.depth).toBe(0);
    expect(premiseState?.fsrs.stability).toBeGreaterThan(0);
    expect(listEvidenceForNode(db, ids.get('dominant') as string)).toHaveLength(1);
  });

  it('keeps the learner\'s own words across recomputes', () => {
    const db = openDatabase(':memory:');
    const ids = seedExampleGraph(db);
    const id = ids.get('nash') as string;
    setOwnStatement(db, id, 'nobody wants to move alone', 'stuck chairs');
    recordEvidence(db, { nodeId: id, kind: 'check', score: 1, reasoning: 'right' });
    const s = getState(db, id);
    expect(s?.ownStatement).toBe('nobody wants to move alone');
    expect(s?.handle).toBe('stuck chairs');
    expect(s?.depth).toBe(2);
  });

  it('rejects evidence for unknown nodes', () => {
    const db = openDatabase(':memory:');
    expect(() => recordEvidence(db, { nodeId: 'nope', kind: 'check', score: 1, reasoning: '' })).toThrow(/unknown node/);
  });
});

describe('goals and tiers', () => {
  it('compiles targets and refreshes target depths and tiers', () => {
    const db = openDatabase(':memory:');
    const ids = seedExampleGraph(db);
    const goal = createGoal(db, 'Pass the game theory exam', 2);
    addCapabilities(db, goal.id, [
      { statement: 'Find Nash equilibria', targets: [{ nodeId: ids.get('nash') as string, depth: 4 }, { nodeId: ids.get('findPureNash') as string, depth: 4 }] },
      { statement: 'Know what SPE is', targets: [{ nodeId: ids.get('spe') as string, depth: 2 }] },
    ]);
    expect(listGoals(db)[0]?.kind).toBe('personal');
    expect(listTargets(db, goal.id)).toHaveLength(3);
    refreshGoalFields(db);
    expect(getState(db, ids.get('nash') as string)?.targetDepth).toBe(4);
    expect(getState(db, ids.get('nash') as string)?.tier).toBe('internalize');
    expect(getState(db, ids.get('spe') as string)?.tier).toBe('index');
    expect(getState(db, ids.get('minimax') as string)?.tier).toBe('archive');
    const view = loadKnowledge(db);
    // nash has chains into it whose premises are not owned yet
    expect(view.fringe.has(ids.get('nash') as string)).toBe(false);
  });
});

describe('bugs, sessions, embeddings', () => {
  it('round-trips bugs', () => {
    const db = openDatabase(':memory:');
    const ids = seedExampleGraph(db);
    const bug = recordBug(db, ids.get('nash') as string, 'thinks Nash means best outcome for all');
    expect(listBugsForNode(db, ids.get('nash') as string)).toHaveLength(1);
    resolveBug(db, bug.id);
    expect(listBugsForNode(db, ids.get('nash') as string)).toHaveLength(0);
    expect(listBugsForNode(db, ids.get('nash') as string, true)).toHaveLength(1);
  });

  it('round-trips sessions and events', () => {
    const db = openDatabase(':memory:');
    const session = createSession(db, null, { step: 1 });
    saveSessionState(db, session.id, { step: 2 });
    appendSessionEvent(db, session.id, 'predict', { answer: 'x' });
    expect(activeSession<{ step: number }>(db)?.state.step).toBe(2);
    expect(listSessionEvents(db, session.id)[0]?.kind).toBe('predict');
    endSession(db, session.id, 'done');
    expect(activeSession(db)).toBeUndefined();
  });

  it('round-trips embeddings as float32', () => {
    const db = openDatabase(':memory:');
    const ids = seedExampleGraph(db);
    upsertEmbedding(db, { nodeId: ids.get('nash') as string, model: 'm', vector: new Float32Array([0.5, -1, 2]), textHash: 'h' });
    const [e] = listEmbeddings(db, 'm');
    expect(Array.from(e?.vector ?? [])).toEqual([0.5, -1, 2]);
    expect(newId('x')).toMatch(/^x_[0-9a-z]{10}$/);
  });
});
