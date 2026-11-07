/**
 * Live check of the card writer with the real model: seeds the example graph into a temporary
 * database and asks for (1) the automatic cards of an idea a session taught with a formula, (2) the
 * cards of an idea that is about understanding (zero is the expected answer), and (3) a draft from a
 * selected formula. Prints every card. Three model calls; run deliberately: `npm run live:cards`.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProvider } from '../backend/llm';
import { SettingsSchema } from '../backend/settings/schema';
import { openDatabase } from '../backend/store/db';
import { markCompiled, createGoal } from '../backend/store/goals';
import { seedExampleGraph } from '../backend/store/seed/exampleGraph';
import { createSession, endSession } from '../backend/store/sessions';
import { draftFor, writeCardsForIdea } from '../backend/services/cards';

const dir = mkdtempSync(join(tmpdir(), 'frontier-live-cards-'));
const db = openDatabase(join(dir, 'frontier.db'));
const ids = seedExampleGraph(db);
const id = (key: string) => ids.get(key) as string;
const goal = createGoal(db, 'Pass the game theory exam: find and justify Nash equilibria of small games');
markCompiled(db, goal.id, 'Game theory', [], { level: 'working' });
const session = createSession(db, goal.id, {});
endSession(db, session.id, 'done');

const settings = SettingsSchema.parse({ provider: process.env['FRONTIER_PROVIDER'] ?? 'agentSdk', apiKey: process.env['ANTHROPIC_API_KEY'] ?? '' });
const deps = { db, provider: createProvider(settings, mkdtempSync(join(tmpdir(), 'frontier-agent-'))) };

const show = (label: string, cards: { front: string; back: string }[]) => {
  console.log(`\n=== ${label}: ${cards.length} ${cards.length === 1 ? 'card' : 'cards'}`);
  for (const c of cards) console.log(`--- front\n${c.front}\n--- back\n${c.back}\n`);
};

const FORMULA = [
  'A **Nash equilibrium** is a strategy profile $s^* = (s_1^*, \\dots, s_n^*)$ in which no player gains by deviating alone:',
  '',
  '$$',
  'u_i(s_i^*, s_{-i}^*) \\ge u_i(s_i, s_{-i}^*) \\quad \\text{for every player } i \\text{ and every strategy } s_i.',
  '$$',
  '',
  "Here $u_i$ is player $i$'s payoff and $s_{-i}^*$ is what everyone else plays. John Nash proved in 1950 that every finite game has at least one equilibrium in mixed strategies.",
].join('\n');

show(
  'Automatic cards for Nash equilibrium',
  await writeCardsForIdea(deps, {
    sessionId: session.id,
    goalId: goal.id,
    nodeId: id('nash'),
    taught: [FORMULA],
    answers: [
      { question: 'What would make a pair of prices stable?', answer: 'when neither firm can make more by changing its own price', score: 0.8 },
      { question: "In the prisoner's dilemma, is (Cooperate, Cooperate) a Nash equilibrium?", answer: 'yes because both are better off', score: 0.2 },
    ],
  }),
);

show(
  'Automatic cards for "Every SPE is a Nash equilibrium" (about understanding)',
  await writeCardsForIdea(deps, {
    sessionId: session.id,
    goalId: goal.id,
    nodeId: id('speIsNash'),
    taught: ['The whole game is one of its own subgames. A subgame perfect equilibrium is a Nash equilibrium in every subgame, so in particular in the whole game: subgame perfection only adds conditions on top of Nash.'],
    answers: [{ question: 'Why is every SPE also a Nash equilibrium?', answer: 'because the whole game counts as a subgame so the SPE must be Nash there too', score: 0.9 }],
  }),
);

show('Draft from the selected formula', [
  await draftFor(deps, {
    ideaIds: [id('nash')],
    goalId: goal.id,
    selection: { text: '$u_i(s_i^*, s_{-i}^*) \\ge u_i(s_i, s_{-i}^*) \\quad \\text{for every player } i \\text{ and every strategy } s_i.$', message: FORMULA },
  }),
]);
db.close();
