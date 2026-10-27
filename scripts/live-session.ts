/**
 * Live check of the teaching loop with the real model: seeds the example graph into a temporary
 * database, compiles a small goal by hand, plans a session and walks a few cards with canned
 * learner answers. Run deliberately: `npm run live:session [-- maxCards]`.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProvider } from '../backend/llm';
import { SettingsSchema } from '../backend/settings/schema';
import { openDatabase } from '../backend/store/db';
import { createGoal, saveCompile } from '../backend/store/goals';
import { seedExampleGraph } from '../backend/store/seed/exampleGraph';
import { getState, listEvidenceForSession } from '../backend/store/evidence';
import { recordEvidence } from '../backend/services/evidence';
import { refreshGoalFields } from '../backend/services/knowledge';
import { respond, startSession } from '../backend/services/session';

const maxCards = Number(process.argv[2] ?? 6);
const dir = mkdtempSync(join(tmpdir(), 'frontier-live-session-'));
const db = openDatabase(join(dir, 'frontier.db'));
const ids = seedExampleGraph(db);
for (const key of ['strategy', 'payoff']) recordEvidence(db, { nodeId: ids.get(key) as string, kind: 'explain', score: 0.95, reasoning: 'assumed known for the live check' });
const goal = createGoal(db, 'Pass the game theory exam: find and justify Nash equilibria of small matrix games');
saveCompile(db, goal.id, [
  { statement: 'Can find all pure Nash equilibria of a 3x3 game and justify each', targets: [{ nodeId: ids.get('nash') as string, depth: 3 }, { nodeId: ids.get('bestResponse') as string, depth: 2 }, { nodeId: ids.get('profile') as string, depth: 1 }] },
]);
refreshGoalFields(db);

const settings = SettingsSchema.parse({ provider: process.env['FRONTIER_PROVIDER'] ?? 'agentSdk', apiKey: process.env['ANTHROPIC_API_KEY'] ?? '' });
const deps = { db, provider: createProvider(settings, mkdtempSync(join(tmpdir(), 'frontier-agent-'))) };

const answers: Record<string, string> = {
  index: 'One strategy chosen for every player, written as a tuple.',
  predict: 'A profile is stable when nobody can do better by changing only their own move.',
  check: 'Yes, because each player is already playing the best reply to the other.',
  derive: 'Take best responses for each player; a profile where every strategy is a best response to the others is exactly a Nash equilibrium, and conversely any Nash profile has each strategy best-responding.',
  connect: 'This requires best response; it differs from a dominant strategy equilibrium in that a best response is only best against what the others actually play.',
  compress: 'A Nash equilibrium is a profile where every player is best-responding to the others, so nobody wants to move alone.',
  use: 'The equilibrium is the cell where both marks coincide; in the other game there is none in pure strategies because best responses cycle.',
};

let snap = await startSession(deps, goal.id);
console.log(`plan: ${snap.plan.title} — ${snap.plan.steps.map((s) => `${s.name} [${s.mode}]`).join(', ')}`);
snap = await respond(deps, snap.id, { answer: '' });
let cards = 0;
while (snap.phase === 'teach' && snap.card && cards < maxCards) {
  cards += 1;
  const stage = snap.card.stage;
  console.log(`\n--- ${snap.current?.name} · ${stage} ---`);
  console.log(JSON.stringify(snap.card, null, 2).slice(0, 1200));
  const response = stage === 'explain' || stage === 'support' ? { answer: '', effort: 3 } : { answer: answers[stage] ?? 'I am not sure.', confidence: 0.66 };
  snap = await respond(deps, snap.id, response);
  const graded = snap.history.nodes.flatMap((n) => n.items).at(-1)?.grade;
  if (graded) console.log(`grade: ${graded.score} — ${graded.feedback.slice(0, 300)}`);
}
console.log(`\nphase after ${cards} cards: ${snap.phase}`);
console.log(`evidence rows: ${listEvidenceForSession(db, snap.id).length}; own statement on Nash: ${getState(db, ids.get('nash') as string)?.ownStatement ?? '(none)'}`);
db.close();
