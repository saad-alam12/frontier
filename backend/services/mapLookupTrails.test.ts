import { describe, expect, it } from 'vitest';
import { FakeEmbedder } from '../ingest/embedder';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { openDatabase } from '../store/db';
import { listEvidenceForNode } from '../store/evidence';
import { addCapabilities, createGoal } from '../store/goals';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { upsertEmbedding } from '../store/embeddings';
import { listNodes } from '../store/world';
import { textHash } from '../ingest/embedder';
import { recordEvidence, setOwnStatement } from './evidence';
import { embeddingText } from './ingestion';
import { refreshGoalFields } from './knowledge';
import { fuzzyScore, looksLikeQuestion, lookup, openCard, searchIdeas } from './lookup';
import { mapView, nodeCard } from './map';
import { listTrails, trail } from './trails';
import { abandonSession, respond, startSession } from './session';

async function setup() {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const id = (k: string) => ids.get(k) as string;
  const embedder = new FakeEmbedder();
  const nodes = listNodes(db);
  const vectors = await embedder.embed(nodes.map(embeddingText));
  nodes.forEach((n, i) => upsertEmbedding(db, { nodeId: n.id, model: embedder.model, vector: vectors[i] as Float32Array, textHash: textHash(embeddingText(n)) }));
  for (const k of ['strategy', 'payoff']) recordEvidence(db, { nodeId: id(k), kind: 'explain', score: 0.95, reasoning: 't' });
  return { db, id, embedder };
}

describe('map', () => {
  it('shows every idea with its place relative to the edge, and chains', async () => {
    const { db, id } = await setup();
    const goal = createGoal(db, 'Exam');
    addCapabilities(db, goal.id, [{ statement: 'Can find equilibria', targets: [{ nodeId: id('nash'), depth: 3 }] }]);
    refreshGoalFields(db);
    const map = mapView(db);
    expect(map.nodes.length).toBe(36);
    const at = new Map(map.nodes.map((n) => [n.id, n]));
    expect(at.get(id('strategy'))?.state).toBe('owned');
    expect(at.get(id('bestResponse'))?.state).toBe('fringe');
    expect(at.get(id('nash'))?.state).toBe('beyond');
    expect(at.get(id('nash'))?.goals).toEqual([goal.id]);
    expect(map.counts.owned).toBe(2);
    expect(map.chains.length).toBeGreaterThan(20);
  });

  it('gives a card with chains, the derivation path from what you own, and no lookup evidence', async () => {
    const { db, id } = await setup();
    const card = nodeCard(db, id('nash'));
    expect(card.builtOn).toEqual([[{ id: id('profile'), name: 'Strategy profile' }, { id: id('bestResponse'), name: 'Best response' }]]);
    expect(card.leadsTo.map((r) => r.name)).toContain('Nash equilibrium is mutual best response');
    expect(card.derivation.map((d) => d.name)).toEqual(['Strategy', 'Strategy profile', 'Payoff function', 'Best response', 'Nash equilibrium']);
    expect(card.derivation.filter((d) => d.owned).map((d) => d.name)).toEqual(['Strategy', 'Payoff function']);
    expect(listEvidenceForNode(db, id('nash'))).toHaveLength(0);
  });
});

describe('lookup', () => {
  it('finds an idea by paraphrase, by a partial name and by the learner’s own words', async () => {
    const { db, id, embedder } = await setup();
    const byMeaning = await searchIdeas({ db, embedder }, 'no player gains by changing their own strategy alone');
    expect(byMeaning[0]?.nodeId).toBe(id('nash'));
    expect(byMeaning[0]?.match).toBe('meaning');
    const byName = await searchIdeas({ db }, 'nash eq');
    expect(byName[0]?.nodeId).toBe(id('nash'));
    setOwnStatement(db, id('bestResponse'), 'the reply that pays most given the others', 'best reply');
    const byOwn = await searchIdeas({ db }, 'best reply');
    expect(byOwn.map((h) => h.nodeId)).toContain(id('bestResponse'));
    expect(fuzzyScore('Strategy', ['Strategy'])).toBe(1);
    expect(await searchIdeas({ db }, '   ')).toEqual([]);
  });

  it('answers a question from the learner’s cards only, citing them', async () => {
    const { db, id, embedder } = await setup();
    const provider = new FakeProvider({
      librarian: [
        { answer: 'Made up.', cited: ['node_not_given'] }, // rejected: not a given card
        (req: CompleteRequest<unknown>) => {
          const cited = [...(req.messages[0]?.content ?? '').matchAll(/### \[(node_[a-z0-9_]+)\]/g)].map((m) => m[1] as string).slice(0, 2);
          return { answer: 'Every SPE is a Nash equilibrium of the whole game; subgame perfection also asks for equilibrium in every subgame.', cited };
        },
      ],
    });
    const result = await lookup({ db, embedder, provider }, 'What is the difference between subgame perfect equilibrium and Nash equilibrium?');
    expect(result.hits.map((h) => h.nodeId)).toEqual(expect.arrayContaining([id('spe'), id('nash')]));
    expect(result.answer?.text).toMatch(/subgame/);
    expect(result.answer?.cited.length).toBeGreaterThan(0);
    expect(provider.calls.filter((c) => c.role === 'librarian')).toHaveLength(1);
    // a bare name gets hits, no model call
    const before = provider.calls.length;
    await lookup({ db, embedder, provider }, 'Nash');
    expect(provider.calls.length).toBe(before);
    expect(looksLikeQuestion('why does backward induction work')).toBe(true);
    expect(looksLikeQuestion('Subgame')).toBe(false);
  });

  it('records a lookup as a weak review once per idea per day', async () => {
    const { db, id } = await setup();
    openCard(db, id('nash'));
    openCard(db, id('nash'));
    const lookups = listEvidenceForNode(db, id('nash')).filter((e) => e.kind === 'lookup');
    expect(lookups).toHaveLength(1);
    expect(nodeCard(db, id('nash')).depth).toBe(0); // a lookup never certifies depth
  });
});

describe('trails', () => {
  it('replays a past session from its events, without answer keys', async () => {
    const { db, id } = await setup();
    const goal = createGoal(db, 'Exam');
    addCapabilities(db, goal.id, [{ statement: 'Can find equilibria', targets: [{ nodeId: id('profile'), depth: 1 }, { nodeId: id('bestResponse'), depth: 2 }] }]);
    refreshGoalFields(db);
    const tutor = (req: CompleteRequest<unknown>) => {
      const text = req.messages[0]?.content ?? '';
      const next = /[Pp]roduce the \*\*(\w+)\*\* card/.exec(text)?.[1] ?? null;
      const grade = /Grade the response/.test(text) ? { score: 0.8, feedback: 'Good.', misconception: null, confidentlyWrong: false } : null;
      const cards: Record<string, unknown> = {
        index: { stage: 'index', gist: 'A profile lists one strategy per player.', placement: 'Under Nash.', question: 'What is a profile?', answerKey: 'SECRET KEY one per player' },
        predict: { stage: 'predict', prompt: 'What would you pick?' },
        explain: { stage: 'explain', markdown: 'The best reply.' },
        check: { stage: 'check', question: 'Is this a best reply?', answerKey: 'SECRET KEY yes', rubric: ['says yes'] },
        connect: { stage: 'connect', prompt: 'Link it.' },
        compress: { stage: 'compress', prompt: 'Own words.' },
        use: { stage: 'use', task: 'Find it.', answerKey: 'SECRET KEY found', rubric: ['finds it'] },
      };
      return { grade, card: next ? cards[next] : null };
    };
    const provider = new FakeProvider({ tutor });
    provider.script('planner', (req: CompleteRequest<unknown>) => {
      const text = (req.messages[0]?.content ?? '').split('## Candidates')[1] ?? '';
      const picks = [...text.matchAll(/- \[(node_[a-z0-9_]+)\]/g)].map((m) => m[1] as string).slice(0, 2);
      return { title: 'Profiles and replies', orientation: 'Two ideas today.', steps: picks.map((nodeId) => ({ nodeId, why: 'needed' })) };
    });
    const deps = { db, provider };
    let snap = await startSession(deps, goal.id);
    snap = await respond(deps, snap.id, { answer: '' });
    for (let i = 0; i < 4 && snap.phase === 'teach'; i += 1) snap = await respond(deps, snap.id, { answer: 'my answer', confidence: 0.66 });
    await abandonSession(deps, snap.id);

    const list = listTrails(db);
    expect(list[0]?.id).toBe(snap.id);
    expect(list[0]?.title).toBe('Profiles and replies');
    expect(list[0]?.status).toBe('abandoned');
    expect(list[0]?.answers).toBeGreaterThan(0);
    const replay = trail(db, snap.id);
    expect(replay.items[0]?.type).toBe('plan');
    expect(replay.items.at(-1)).toMatchObject({ type: 'end', status: 'abandoned' });
    const steps = replay.items.filter((i) => i.type === 'step');
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps.filter((s) => s.type === 'step' && s.response?.answer === 'my answer').length).toBeGreaterThan(0);
    expect(JSON.stringify(replay)).not.toContain('SECRET KEY');
    expect(listTrails(db, id('payoff'))).toHaveLength(0);
  });
});
