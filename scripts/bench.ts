/**
 * How the app's reads hold up as the map grows: `npx tsx scripts/bench.ts [--ideas 2000]`.
 *
 * Builds a map of that many ideas in memory (chains between them, half of them learned over four
 * months of evidence, three goals, a flashcard on most learned ideas with its reviews, study time),
 * then times each read the window makes: the first read after a write, and the same read again with
 * nothing written in between, each the median of five runs (`--only Today` for one read, to
 * profile it with `--profile reads.cpuprofile`). No model, no network; nothing on disk but a profile.
 */
import { openDatabase } from '../backend/store/db';
import { applyMergePlan } from '../backend/store/worldWrites';
import { addCapabilities, markCompiled } from '../backend/store/goals';
import { logTime } from '../backend/store/activity';
import { newId } from '../backend/store/ids';
import { approveGoalPlan, createGoalFromForm, goalDetail, listGoalDetails } from '../backend/services/goals';
import { timeOwners } from '../backend/services/budget';
import { recordEvidence } from '../backend/services/evidence';
import { refreshGoalFields, loadKnowledge } from '../backend/services/knowledge';
import { cardQueue, cardStats, cardSummary, listCardViews, reviewCard, saveCard } from '../backend/services/cards';
import { todayView } from '../backend/services/today';
import { mapView, nodeCard } from '../backend/services/map';
import { statsView } from '../backend/services/stats';
import { weekReview } from '../backend/services/weekReview';
import { misconceptionsView } from '../backend/services/misconceptions';
import type { Chain, KnowledgeNode } from '../backend/core/types';
import type { CardRating } from '../backend/core/cards';
import { Session } from 'node:inspector/promises';
import { writeFileSync } from 'node:fs';

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const IDEAS = arg('ideas', 2000);
const DAYS = 120;
const now = new Date();
const daysAgo = (d: number, hour = 19) => new Date(now.getTime() - d * 86_400_000 + (hour - now.getHours()) * 3_600_000);
// a fixed sequence, so two runs build the same map
let seed = 7;
const random = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)] as T;

const db = openDatabase(':memory:');
const started = performance.now();

// the world: ideas, each resting on up to three earlier ones
const nodes: KnowledgeNode[] = Array.from({ length: IDEAS }, (_, i) => ({ id: newId('node'), kind: 'claim', name: `Idea ${i + 1}`, statement: `Statement of idea ${i + 1}.`, aliases: [], sources: [], status: 'verified' }));
const chains: Chain[] = [];
nodes.forEach((n, i) => {
  if (i < 10) return;
  const premises = [...new Set(Array.from({ length: 1 + Math.floor(random() * 3) }, () => nodes[Math.floor(random() * i)]?.id as string))];
  chains.push({ id: newId('chain'), premises, conclusion: n.id, sources: [] });
});
applyMergePlan(db, { newNodes: nodes, nodeUpdates: [], newChains: chains, chainUpdates: [], droppedChainIds: [], coveredNodeIds: [], skippedChains: [], examples: [] });

// three goals, each wanting a third of the map at depth 2
for (let g = 0; g < 3; g += 1) {
  const goal = createGoalFromForm(db, { text: `Goal ${g + 1}`, budget: { mode: 'total', hours: 200 }, wantedLevel: null, context: null, materials: [] }, { draft: true });
  const mine = nodes.filter((_, i) => i % 3 === g);
  const capabilities = Array.from({ length: Math.ceil(mine.length / 20) }, (_, c) => ({ statement: `Skill ${c + 1}`, targets: mine.slice(c * 20, c * 20 + 20).map((n) => ({ nodeId: n.id, depth: 2 as const })) }));
  addCapabilities(db, goal.id, capabilities);
  markCompiled(db, goal.id, `Goal ${g + 1}`, [], { level: 'working', scope: 'Everything.' });
  approveGoalPlan(db, goal.id);
}

// half the ideas learned over four months: a few answers each, and a flashcard with its reviews
const learned = nodes.slice(0, Math.floor(IDEAS / 2));
let evidence = 0;
let reviews = 0;
for (const n of learned) {
  const first = Math.floor(random() * DAYS);
  for (let k = 0; k < 6; k += 1) {
    const day = Math.max(0, first - k * Math.floor(first / 6));
    recordEvidence(db, { nodeId: n.id, kind: pick(['explain', 'check', 'use'] as const), score: 0.5 + random() * 0.5, reasoning: 'bench', at: daysAgo(day).toISOString() });
    evidence += 1;
  }
  const card = saveCard(db, { front: `What is ${n.name}?`, back: n.statement, nodeIds: [n.id], goalId: null });
  for (let k = 0; k < 8; k += 1) {
    reviewCard(db, card.id, pick([2, 3, 3, 3, 4] as CardRating[]), daysAgo(Math.max(0, first - k * Math.ceil(first / 8))));
    reviews += 1;
  }
}
// study time as the app logs it: a span per idea worked on, five a day, with the goals it belongs to
for (let d = 0; d < DAYS; d += 1) {
  for (let k = 0; k < 5; k += 1) {
    const nodeId = pick(learned).id;
    logTime(db, 'session', { goalId: null, nodeId }, 600, daysAgo(d, 9 + k * 2), () => timeOwners(db, { nodeId }));
  }
}
refreshGoalFields(db);
console.log(`Built ${IDEAS} ideas, ${chains.length} chains, ${evidence} answers, ${learned.length} cards with ${reviews} reviews in ${Math.round((performance.now() - started) / 1000)} s.\n`);

const goals = listGoalDetails(db, () => ({ state: 'idle' }));
const goalId = goals[0]?.goal.id as string;
const reads: [string, () => unknown][] = [
  ['Today', () => todayView(db)],
  ['Goals list', () => listGoalDetails(db, () => ({ state: 'idle' }))],
  ['A goal page', () => goalDetail(db, goalId)],
  ['Map', () => mapView(db)],
  ["An idea's card", () => nodeCard(db, pick(learned).id)],
  ['Cards: queue', () => cardQueue(db, null)],
  ['Cards: summary (sidebar)', () => cardSummary(db, null)],
  ['Cards: list', () => listCardViews(db, {})],
  ['Cards: stats', () => cardStats(db, { goalId: null, range: '30d' })],
  ['Stats', () => statsView(db, { goalId: null, topicId: null, range: '30d' })],
  ['Your week', () => weekReview(db, null)],
  ['Misconceptions', () => misconceptionsView(db)],
  ['Knowledge view', () => loadKnowledge(db)],
  ['After an answer (goal fields)', () => refreshGoalFields(db)],
];
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
// `--profile out.cpuprofile`: a CPU profile of the reads alone, without building the map
const profileTo = process.argv.includes('--profile') ? process.argv[process.argv.indexOf('--profile') + 1] : null;
const inspector = profileTo ? new Session() : null;
if (inspector) {
  inspector.connect();
  await inspector.post('Profiler.enable');
  await inspector.post('Profiler.start');
}
console.log(`${''.padEnd(32)}  after a write   again`);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;
for (const [name, read] of reads) {
  if (only && !name.toLowerCase().startsWith(only.toLowerCase())) continue;
  const cold: number[] = [];
  const warm: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    // a second of study time, as the window logs while the learner works: any write starts reads afresh
    logTime(db, 'session', { goalId: null, nodeId: learned[0]?.id ?? null }, 1, new Date(), () => []);
    let t = performance.now();
    read();
    cold.push(performance.now() - t);
    t = performance.now();
    read();
    warm.push(performance.now() - t);
  }
  console.log(`${name.padEnd(32)} ${String(Math.round(median(cold))).padStart(6)} ms ${String(Math.round(median(warm))).padStart(6)} ms`);
}
if (inspector && profileTo) {
  const { profile } = await inspector.post('Profiler.stop');
  writeFileSync(profileTo, JSON.stringify(profile));
}
