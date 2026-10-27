import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { FakeEmbedder } from '../ingest/embedder';
import { openDatabase } from '../store/db';
import { listChunks, listSources } from '../store/sources';
import { countNodes, listChains, listExamplesForNode, listNodes } from '../store/world';
import { countEmbeddings } from '../store/embeddings';
import { IngestionService } from './ingestion';
import type { IngestProgress } from './ingestion';
import { deltaForSource, listSourceSummaries } from './library';
import { recordEvidence } from './evidence';
import { createGoal, saveCompile } from '../store/goals';
import { refreshGoalFields } from './knowledge';

/** Scripted extractor: reads a tiny marker language from the chunk text so fixtures stay readable. */
function extractorFromFixture(req: CompleteRequest<unknown>) {
  const text = req.messages[0]?.content ?? '';
  const nodes: unknown[] = [];
  const chains: unknown[] = [];
  const digestIds = [...text.matchAll(/^- \[(node_[a-z0-9_]+)\] ([^(]+) \(/gm)].map((m) => ({ id: m[1] as string, name: (m[2] as string).trim() }));
  const byName = new Map(digestIds.map((d) => [d.name.toLowerCase(), d.id]));
  let n = 0;
  const temp = new Map<string, string>();
  const ref = (name: string) => temp.get(name.toLowerCase()) ?? byName.get(name.toLowerCase()) ?? name;
  for (const m of text.matchAll(/NODE\[(claim|term|procedure)\] ([^:]+): ([^\n]+)/g)) {
    const name = (m[2] as string).trim();
    if (byName.has(name.toLowerCase())) continue; // already in the graph so far: reference, do not restate
    n += 1;
    temp.set(name.toLowerCase(), `n${n}`);
    nodes.push({ tempId: `n${n}`, kind: m[1], name, statement: (m[3] as string).trim(), aliases: [] });
  }
  for (const m of text.matchAll(/CHAIN ([^=]+)=> ([^\n]+)/g)) {
    chains.push({ premises: (m[1] as string).split('+').map((s) => ref(s.trim())), conclusion: ref((m[2] as string).trim()) });
  }
  const examples = [...text.matchAll(/EXAMPLE\[([^\]]+)\] ([^:]+): ([^\n]+)/g)].map((m) => ({ illustrates: ref((m[1] as string).trim()), title: (m[2] as string).trim(), body: (m[3] as string).trim() }));
  return { nodes, chains, examples, conflicts: [] };
}

/** Scripted matcher: same lowercase name means same node. */
function matcherByName(req: CompleteRequest<unknown>) {
  const text = req.messages[0]?.content ?? '';
  const decisions: unknown[] = [];
  for (const block of text.split(/^### /m).slice(1)) {
    const head = /^(n\d+): ([^(]+) \(/.exec(block);
    if (!head) continue;
    const name = (head[2] as string).trim().toLowerCase();
    let match: string | null = null;
    for (const c of block.matchAll(/- \[(node_[a-z0-9_]+)\] ([^(]+) \(/g)) {
      if ((c[2] as string).trim().toLowerCase() === name) match = c[1] as string;
    }
    decisions.push({ tempId: head[1], match, confidence: match ? 0.95 : 0.9, reasoning: match ? 'same name' : 'different' });
  }
  return { decisions };
}

const LECTURE_A = `# Lecture 2: Equilibrium

## Best responses

NODE[term] Best response: A strategy that maximizes a player's payoff given the strategies of the others.
NODE[term] Strategy profile: One strategy for each player.
NODE[term] Nash equilibrium: A strategy profile in which no player can gain by changing only their own strategy.
CHAIN Strategy profile + Best response => Nash equilibrium

## Dominance

NODE[term] Strictly dominant strategy: A strategy that beats every other strategy of the same player whatever the others do.
NODE[claim] Dominant strategies give a Nash equilibrium: If every player has a strictly dominant strategy, the profile of dominant strategies is the unique Nash equilibrium.
CHAIN Strictly dominant strategy + Nash equilibrium => Dominant strategies give a Nash equilibrium
`;

const LECTURE_B = `# Notes on equilibrium

NODE[term] Nash equilibrium: No player wants to deviate unilaterally.
NODE[term] Best response: The payoff-maximizing reply to what the others do.
NODE[claim] Nash equilibrium is mutual best response: A profile is a Nash equilibrium exactly when every player's strategy is a best response to the others.
CHAIN Nash equilibrium + Best response => Nash equilibrium is mutual best response
NODE[claim] Dominant strategies give a Nash equilibrium: Dominant strategy profiles are Nash equilibria.
`;

function setup(script: Parameters<typeof FakeProvider.prototype.script>[1][] = []) {
  const db = openDatabase(':memory:');
  const provider = new FakeProvider({ extractor: extractorFromFixture, matcher: matcherByName });
  for (const s of script) provider.script('extractor', s);
  const events: IngestProgress[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'frontier-ingest-'));
  const service = new IngestionService({ db, provider, embedder: new FakeEmbedder(), sourcesDir: join(dir, 'sources'), onProgress: (p) => events.push(p) });
  return { db, provider, service, events, dir };
}

const FILLER = 'Slide notes that only repeat what came before. '.repeat(140);

/** A lecture whose summary slide and worked example land in chunks of their own. */
const LECTURE_C = `# Lecture 3: Equilibria in practice

## Equilibrium

NODE[term] Strategy profile: One strategy for each player.
NODE[term] Nash equilibrium: A strategy profile in which no player can gain by changing only their own strategy.
CHAIN Strategy profile => Nash equilibrium

${FILLER}

## Worked example

Find the equilibrium of the coordination game with payoffs (2,2), (0,0), (0,0), (1,1).
EXAMPLE[Nash equilibrium] Equilibria of a coordination game: Check each cell for profitable deviations: (A,A) and (B,B) are equilibria, the mixed cells are not.

${FILLER}

## Summary

Recap: a strategy profile lists one strategy per player; a Nash equilibrium is a profile with no profitable unilateral deviation.
`;

describe('ingestion pipeline', () => {
  it('attaches worked examples to the idea they illustrate and makes no node of a summary slide', async () => {
    const { db, provider, service } = setup();
    const { source } = await service.addText({ kind: 'markdown', title: 'Lecture 3', text: LECTURE_C });
    expect(listChunks(db, source.id).length).toBeGreaterThanOrEqual(3);
    await service.runSource(source.id);
    expect(listNodes(db).map((n) => n.name).sort()).toEqual(['Nash equilibrium', 'Strategy profile']);
    const nash = listNodes(db).find((n) => n.name === 'Nash equilibrium') as { id: string };
    const examples = listExamplesForNode(db, nash.id);
    expect(examples).toHaveLength(1);
    expect(examples[0]).toMatchObject({ title: 'Equilibria of a coordination game', sourceId: source.id });
    const system = provider.calls.find((c) => c.role === 'extractor')?.system ?? '';
    expect(system).toMatch(/Summary, recap, outline and overview slides restate ideas/);
    expect(system).toMatch(/Worked examples are not ideas/);
    expect(system).toMatch(/Headline ideas first/);
  });

  it('ingests a markdown lecture into nodes and chains with citations', async () => {
    const { db, service, dir, events } = setup();
    const file = join(dir, 'lecture-a.md');
    writeFileSync(file, LECTURE_A);
    const { source, existed } = await service.addFile(file);
    expect(existed).toBe(false);
    expect(source.kind).toBe('markdown');
    expect(source.title).toBe('Lecture 2: Equilibrium');
    await service.runSource(source.id);

    expect(countNodes(db)).toBe(5);
    const chains = listChains(db);
    expect(chains).toHaveLength(2);
    const nash = listNodes(db).find((n) => n.name === 'Nash equilibrium');
    expect(nash?.sources[0]?.sourceId).toBe(source.id);
    expect(nash?.sources[0]?.locator).toMatch(/Lecture 2/);
    expect(countEmbeddings(db)).toBe(5);
    const summary = listSourceSummaries(db)[0];
    expect(summary?.status).toBe('done');
    expect(summary?.chunks.every((c) => c.status === 'done')).toBe(true);
    expect(events.some((e) => e.status === 'running')).toBe(true);
    expect(events[events.length - 1]?.status).toBe('done');
  });

  it('re-ingesting the same file is a no-op', async () => {
    const { db, service, dir } = setup();
    const file = join(dir, 'lecture-a.md');
    writeFileSync(file, LECTURE_A);
    const first = await service.addFile(file);
    await service.runSource(first.source.id);
    const again = await service.addFile(file);
    expect(again.existed).toBe(true);
    expect(again.source.id).toBe(first.source.id);
    expect(listSources(db)).toHaveLength(1);
    await service.runSource(first.source.id);
    expect(countNodes(db)).toBe(5);
    expect(listChains(db)).toHaveLength(2);
  });

  it('merges duplicates from a second overlapping source', async () => {
    const { db, service, provider } = setup();
    const a = await service.addText({ kind: 'markdown', title: 'A', text: LECTURE_A });
    await service.runSource(a.source.id);
    const b = await service.addText({ kind: 'markdown', title: 'B', text: LECTURE_B });
    await service.runSource(b.source.id);

    const nodes = listNodes(db);
    expect(nodes).toHaveLength(6); // 5 from A + the mutual-best-response claim from B
    const nash = nodes.find((n) => n.name === 'Nash equilibrium');
    expect(nash?.sources.map((s) => s.sourceId).sort()).toEqual([a.source.id, b.source.id].sort());
    const matcherCalls = provider.calls.filter((c) => c.role === 'matcher');
    expect(matcherCalls.length).toBeGreaterThan(0);
    expect(matcherCalls[0]?.messages[0]?.content).toContain('Candidates:');
    expect(listChains(db)).toHaveLength(3);
    const delta = deltaForSource(db, b.source.id);
    expect(delta.total).toBe(4);
  });

  it('isolates a failing chunk, reports it, and retries on the next run', async () => {
    const { db, service, provider } = setup();
    const src = await service.addText({ kind: 'markdown', title: 'two chunks', text: `${LECTURE_A}\n\n# Part two\n\n${'filler text '.repeat(700)}\n\nNODE[term] Subgame: A part of a game tree starting at one node.\n` });
    expect(listChunks(db, src.source.id).length).toBeGreaterThanOrEqual(2);
    // first call succeeds (scripted function), second returns an invalid payload three+ times → failure
    provider.script('extractor', extractorFromFixture, { nodes: 'bad' }, { nodes: 'bad' }, { nodes: 'bad' }, { nodes: 'bad' });
    const result = await service.runSource(src.source.id);
    expect(result.status).toBe('failed');
    const chunks = listChunks(db, src.source.id);
    expect(chunks[0]?.status).toBe('done');
    expect(chunks.some((c) => c.status === 'failed' && /invalid/.test(c.error ?? ''))).toBe(true);
    expect(countNodes(db)).toBe(5);
    // the queue keeps the last step, so the next run still fails; replace the script with a working one
    provider.script('extractor', extractorFromFixture);
    const second = await service.runSource(src.source.id);
    expect(second.status).toBe('done');
    expect(countNodes(db)).toBe(6);
  });

  it('classifies the delta for this learner', async () => {
    const { db, service } = setup();
    const a = await service.addText({ kind: 'markdown', title: 'A', text: LECTURE_A });
    await service.runSource(a.source.id);
    const byName = new Map(listNodes(db).map((n) => [n.name, n.id]));
    const own = (name: string) => recordEvidence(db, { nodeId: byName.get(name) as string, kind: 'explain', score: 0.9, reasoning: 't' });
    own('Strategy profile');
    own('Best response');
    const goal = createGoal(db, 'exam');
    saveCompile(db, goal.id, [{ statement: 'know BR deeply', targets: [{ nodeId: byName.get('Best response') as string, depth: 4 }] }]);
    refreshGoalFields(db);
    const delta = deltaForSource(db, a.source.id);
    const cls = new Map(delta.items.map((i) => [i.name, i.cls]));
    expect(cls.get('Strategy profile')).toBe('known');
    expect(cls.get('Best response')).toBe('deeper');
    expect(cls.get('Nash equilibrium')).toBe('new-fringe');
    expect(cls.get('Dominant strategies give a Nash equilibrium')).toBe('new-beyond');
    expect(delta.sentence).toMatch(/Of 5 ideas/);
    expect(cls.get('Strictly dominant strategy')).toBe('new-fringe'); // a root: learnable now
    expect(delta.counts['new-fringe']).toBe(2);
  });

  it('reports the roots of a fresh source as learnable now when nothing is owned and no goal exists', async () => {
    const { db, service } = setup();
    const a = await service.addText({ kind: 'markdown', title: 'A', text: LECTURE_A });
    await service.runSource(a.source.id);
    const delta = deltaForSource(db, a.source.id);
    const cls = new Map(delta.items.map((i) => [i.name, i.cls]));
    for (const root of ['Best response', 'Strategy profile', 'Strictly dominant strategy']) expect(cls.get(root)).toBe('new-fringe');
    expect(cls.get('Nash equilibrium')).toBe('new-beyond');
    expect(delta.sentence).toContain('3 are new and learnable now');
    // in order of appearance, with citations and the chains in both directions
    expect(delta.items.map((i) => i.name)).toEqual(['Best response', 'Strategy profile', 'Nash equilibrium', 'Strictly dominant strategy', 'Dominant strategies give a Nash equilibrium']);
    const nash = delta.items.find((i) => i.name === 'Nash equilibrium');
    expect(nash?.citations[0]).toMatch(/Lecture 2/);
    expect(nash?.builtOn.map((premises) => premises.map((p) => p.name).sort())).toEqual([['Best response', 'Strategy profile']]);
    expect(nash?.leadsTo.map((l) => l.name)).toEqual(['Dominant strategies give a Nash equilibrium']);
  });
});
