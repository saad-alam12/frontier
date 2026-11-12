/**
 * Build a sandbox with realistic data for screenshots and manual checks, through the real services
 * and the fake model (no network): `npx tsx scripts/sandbox.ts <sandbox folder> [--open-session]`.
 * The folder gets a settings.json whose data folder is `<sandbox>/data`; start the app on it with
 * `FRONTIER_USER_DATA=<sandbox folder> npx electron-vite dev --remoteDebuggingPort 9333`. Model calls
 * in the app fail at once (API provider, no key), so screens with a model call show their error state.
 * Never point it at the learner's data: the folder is wiped first.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { saveImageFile } from '../backend/store/attachments';
import { describeFigure, listFigures, setFigurePicture, syncFigurePages } from '../backend/store/figures';
import { createSource } from '../backend/store/sources';
import { addWatchedFolder } from '../backend/store/watchedFolders';
import { strToU8, zipSync } from 'fflate';
import { FakeProvider } from '../backend/llm/FakeProvider';
import { stageAsked } from '../backend/llm/fakeTutor';
import type { CompleteRequest } from '../backend/llm/provider';
import { openDatabase } from '../backend/store/db';
import type { Database } from '../backend/store/db';
import { logTime } from '../backend/store/activity';
import { addCapabilities, markCompiled } from '../backend/store/goals';
import { seedExampleGraph } from '../backend/store/seed/exampleGraph';
import { approveGoalPlan, createGoalFromForm } from '../backend/services/goals';
import { reviewCard, saveCard } from '../backend/services/cards';
import { recordEvidence } from '../backend/services/evidence';
import { refreshGoalFields } from '../backend/services/knowledge';
import { abandonSession, respond, startSession } from '../backend/services/session';
import type { SessionSnapshot, SessionState } from '../backend/services/session';
import { startFreeSession } from '../backend/services/freeSession';
import { proposeAddition, requestAddition } from '../backend/services/addition';
import { SessionMaker } from '../backend/services/sessionMaker';
import { SessionWork } from '../backend/services/sessionWork';
import { settleGrading, startPractice, submitPracticeAnswer } from '../backend/services/practice';
import { answerDialogue, startDialogue } from '../backend/services/dialogue';
import { saveNote } from '../backend/services/notes';
import { afterAnswer } from '../backend/services/bugs';
import { appendSessionEvent, listEndedSessions, saveSessionState } from '../backend/store/sessions';

const [folderArg, ...flags] = process.argv.slice(2);
/** A diagram and a plot for the explanation (`--drawings`), as the tutor may draw them. */
const DRAWINGS = [
  '',
  'Checking a cell means checking each firm in turn:',
  '',
  '```mermaid',
  'flowchart LR',
  '  A["Pick a cell"] --> B{"Row firm gains by moving?"}',
  '  B -- yes --> X["Not stable"]',
  '  B -- no --> C{"Column firm gains by moving?"}',
  '  C -- yes --> X',
  '  C -- no --> S["Stable: an equilibrium"]',
  '```',
  '',
  "With prices as a continuous choice, each firm's best price is a line in the other's price; the equilibrium is where they cross:",
  '',
  '```plot',
  '{"title": "Best responses in a price war", "x": {"label": "price of firm B", "min": 0, "max": 12}, "y": {"label": "price of firm A", "min": 0, "max": 12}, "curves": [{"label": "best price of A", "y": "2 + 0.5*x"}, {"label": "best price of B, read back", "y": "2*x - 4"}], "points": [{"x": 4, "y": 4, "label": "equilibrium (4, 4)"}]}',
  '```',
].join('\n');
if (!folderArg) {
  console.error('usage: tsx scripts/sandbox.ts <sandbox folder> [--open-session]');
  process.exit(2);
}
const folder = resolve(folderArg);
if (folder.includes(`${join('Frontier')}`) && !folder.includes('sandbox')) throw new Error('refusing a folder that looks like real data');
rmSync(folder, { recursive: true, force: true });
const dataFolder = join(folder, 'data');
mkdirSync(dataFolder, { recursive: true });
// the API provider with no key: the app in the sandbox never reaches a real model (calls fail at once)
writeFileSync(join(folder, 'settings.json'), JSON.stringify({ dataFolder, provider: 'anthropicApi', apiKey: '' }, null, 2));

/** A tutor that writes a plausible card for every stage and grades from a cycle of scores. */
function tutor(scores: number[]) {
  let i = 0;
  return (req: CompleteRequest<unknown>) => {
    const text = req.messages[0]?.content ?? '';
    if (req.submit.name === 'submit_recall') {
      const ids = [...text.matchAll(/- \[(node_[a-z0-9_]+)\]/g)].map((m) => m[1]);
      const closing = /add the closing summary/.test(text);
      return { recalled: ids.map((nodeId) => ({ nodeId, score: 0.8, note: 'Named it and said why.' })), canDo: closing ? 'You can find equilibria in small games and say why they hold.' : null, previewQuestion: closing ? 'What changes when one player moves first?' : null };
    }
    const grading = /Grade the response/.test(text);
    const score = scores[i++ % scores.length] ?? 0.8;
    const next = stageAsked(text, grading ? score : null);
    // shows the idea's figure when it has one, as the real tutor may
    const figure = /## Figures you can show[\s\S]*?^- \[(fig_[a-z0-9]+)\]/m.exec(text)?.[1];
    const grade = grading ? { score, feedback: score >= 0.7 ? 'Right, and you said why: no player gains by moving alone.' : 'Close, but you checked only one player. Each must be best-responding.', misconception: null, confidentlyWrong: false, missingBackground: null } : null;
    const cards: Record<string, unknown> = {
      predict: { stage: 'predict', prompt: 'Two firms set prices at the same time. What would make a pair of prices stable, so neither firm wants to change?' },
      explain: {
        stage: 'explain',
        markdown: `## The idea\n\nA profile is stable when **no player gains by changing their own strategy alone**. Formally, for every player $i$:\n\n$$u_i(s_i, s_{-i}) \\ge u_i(s_i', s_{-i}) \\quad \\text{for all } s_i'$$\n\nSo each strategy is a best response to the others.${figure ? `\n\n![The pricing game as a table: each cell holds both firms' payoffs](figure:${figure})\n\nIn the table, look along a row for the column firm and down a column for the row firm: a cell where neither can do better is stable.` : ''}${flags.includes('--drawings') ? DRAWINGS : ''}`,
      },
      check: { stage: 'check', question: 'In the game below, is (Up, Left) stable? Say which deviation you checked.', answerKey: 'Yes', rubric: ['says yes', 'checks both players'] },
      derive: { stage: 'derive', prompt: 'Rebuild the definition from best responses: what must hold for each player?', answerKey: 'mutual best responses', rubric: ['uses best responses'] },
      connect: { stage: 'connect', prompt: 'State one link between this idea and dominant strategies.' },
      compress: { stage: 'compress', prompt: 'In your own words, at most two sentences.' },
      use: { stage: 'use', task: 'Find every pure equilibrium of the pricing game, and say why the high-high pair is not one.', answerKey: '(Low, Low)', rubric: ['finds it', 'explains high-high'] },
      index: { stage: 'index', gist: 'A strategy profile lists one strategy for each player.', placement: 'Equilibria are profiles with a property, so this comes first.', question: 'What does a profile contain?', answerKey: 'one strategy per player' },
      support: { stage: 'support', markdown: 'Worked example: check each player in turn, holding the other fixed.' },
      reteach: { stage: 'reteach', markdown: 'Think of it one player at a time, not as the best outcome for all.' },
    };
    return { grade, card: next ? cards[next] : null };
  };
}

function planner(req: CompleteRequest<unknown>) {
  const text = (req.messages[0]?.content ?? '').split('## Candidates')[1] ?? '';
  const ids = [...text.matchAll(/- \[(node_[a-z0-9_]+)\]/g)].map((m) => m[1] as string);
  return { title: 'Profiles, best responses and equilibrium', orientation: 'Today builds Nash equilibrium from the two ideas it is made of, then puts it to work.', steps: ids.slice(0, 3).map((nodeId) => ({ nodeId, why: 'The exam asks you to find equilibria by hand.' })) };
}

const sessionPlanner = {
  title: 'How attention works, from scratch',
  summary: 'How a model weighs earlier words when it reads the next one.',
  level: 'intuition',
  ideas: [{ ref: 'n2', aim: 2, why: 'It is what you asked about.' }],
  newIdeas: [
    { tempId: 'n1', kind: 'term', name: 'Dot product', statement: 'Multiply two lists of numbers entry by entry and add the results.', premises: [] },
    { tempId: 'n2', kind: 'claim', name: 'Attention', statement: 'Each word scores every earlier word by a dot product and takes a weighted mix of them.', premises: ['n1'] },
  ],
  background: [],
};

/** A PNG of a 2 × 2 payoff table drawn in boxes, standing in for a page picture (the sandbox has no browser to draw pages). */
function tablePicture(width = 900, height = 560): Buffer {
  const ink = (x: number, y: number): boolean => {
    const left = 150, top = 90, cell = 300, rows = 2;
    const inGrid = x >= left && x <= left + cell * 2 && y >= top && y <= top + (cell * rows) / 1.6;
    const lineX = [0, 1, 2].some((i) => Math.abs(x - (left + i * cell)) < 3);
    const lineY = [0, 1, 2].some((i) => Math.abs(y - (top + (i * cell) / 1.6)) < 3);
    const mark = [0, 1].some((c) => [0, 1].some((r) => Math.hypot(x - (left + cell * c + 150), y - (top + (cell * r) / 1.6 + 94)) < 22));
    return (inGrid && (lineX || lineY)) || mark;
  };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * (width * 3 + 1) + 1 + x * 3;
      raw.fill(ink(x, y) ? 40 : 255, at, at + 3);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const provider = new FakeProvider({ tutor: tutor([0.85, 0.6, 0.9]), tutorEscalation: tutor([0.8]), planner, sessionPlanner: [sessionPlanner], extractor: () => ({ nodes: [], chains: [], conflicts: [] }), matcher: () => ({ decisions: [] }) });
const db: Database = openDatabase(join(dataFolder, 'frontier.db'));
const ids = seedExampleGraph(db);
const id = (key: string) => ids.get(key) as string;
const work = new SessionWork();
const deps = { db, provider, work };
const now = new Date();
const daysAgo = (days: number, hour = 19) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, hour, 10);

// a lecture whose page 7 is mostly a figure: its picture shows Nash equilibrium
const lecture = createSource(db, { kind: 'pdf', title: 'Lecture 3: Equilibrium', path: null, hash: 'sandbox-lecture-3' }, [{ text: '[p7]\nThe pricing game', locator: 'p7' }]);
// lecture notes with real text, for Lookup's passages (marked read, as after reading)
const notes = createSource(db, { kind: 'markdown', title: 'Lecture 5 notes: Sequential games', path: null, hash: 'sandbox-lecture-5' }, [
  { text: 'In a sequential game players move one after another. A strategy says what a player does at every decision node, even at nodes that are never reached.', locator: 'p2' },
  { text: 'A subgame perfect equilibrium (SPE) is a strategy profile that is a Nash equilibrium in every subgame. Every SPE is a Nash equilibrium, but not the other way round: some Nash equilibria rest on threats that are not credible.', locator: 'p7' },
  { text: 'Backward induction finds the SPE of a finite game with perfect information: solve the last decision nodes first, replace them by their outcomes, and work back to the root.', locator: 'p9' },
]);
db.prepare("UPDATE sources SET status = 'done' WHERE id = ?").run(notes.id);
db.prepare("UPDATE sources SET status = 'done', chunks_done = 1 WHERE id = ?").run(lecture.id);
syncFigurePages(db, lecture.id, [{ page: 7, locator: 'p7' }]);
const tableFigure = listFigures(db, lecture.id)[0];
if (tableFigure) {
  setFigurePicture(db, tableFigure.id, { file: saveImageFile(join(dataFolder, 'figures'), tablePicture(), 'image/png'), width: 900, height: 560 });
  describeFigure(db, tableFigure.id, "The pricing game as a 2 × 2 table of both firms' payoffs; the low-low cell is circled.", [id('nash'), id('dominant')]);
}

// what the learner brought: the basics of games
for (const key of ['strategy', 'payoff', 'player']) if (ids.has(key)) recordEvidence(db, { nodeId: id(key), kind: 'explain', score: 0.95, reasoning: 'probe' });

// a goal with a fixed time, mapped and approved
const exam = createGoalFromForm(db, { text: 'Pass the game theory exam with a top grade', budget: { mode: 'total', hours: 20 }, wantedLevel: null, context: 'Written exam in December. I learn best from worked examples.', materials: [] }, { draft: true });
addCapabilities(db, exam.id, [
  { statement: 'Can find the Nash equilibria of a small game by hand', targets: ['profile', 'bestResponse', 'nash', 'findPureNash'].map((k) => ({ nodeId: id(k), depth: k === 'nash' ? (3 as const) : (2 as const), core: k === 'nash' })) },
  { statement: 'Can use dominance to simplify a game', targets: ['dominant', 'dominated', 'iesds'].map((k) => ({ nodeId: id(k), depth: 2 as const })) },
  { statement: 'Can solve a sequential game by backward induction', targets: ['backwardInduction', 'subgame', 'spe'].filter((k) => ids.has(k)).map((k) => ({ nodeId: id(k), depth: 2 as const })) },
]);
markCompiled(db, exam.id, 'Game theory exam', [], { level: 'rigorous', scope: 'Solve and explain small simultaneous and sequential games, as the exam asks.' });
approveGoalPlan(db, exam.id);

// a goal with no time limit, at working depth
const pricing = createGoalFromForm(db, { text: 'Understand how firms compete on price', budget: null, wantedLevel: 'working', context: 'For reading papers on pricing at work.', materials: [] }, { draft: true });
addCapabilities(db, pricing.id, [{ statement: 'Can explain why competing firms end up at low prices', targets: ['nash', 'dominant', 'dominantNash'].filter((k) => ids.has(k)).map((k) => ({ nodeId: id(k), depth: 2 as const })) }]);
markCompiled(db, pricing.id, 'Price competition', [], { level: 'working', scope: 'Explain the main models of price competition in plain words.' });
approveGoalPlan(db, pricing.id);
refreshGoalFields(db);

/** Answer cards until the session reaches `phase`, or `cards` answers have gone. */
async function answer(snap: SessionSnapshot, cards: number): Promise<SessionSnapshot> {
  let s = await respond(deps, snap.id, { answer: '' });
  for (let i = 0; i < cards && s.phase === 'teach'; i += 1) s = await respond(deps, s.id, { answer: 'No player can gain by changing their own strategy alone, so each is a best response.', confidence: 0.66 });
  return s;
}

// three earlier planned sessions on the exam goal, a free session, and study time over two weeks
for (const [days, minutes] of [
  [12, 35],
  [9, 50],
  [5, 42],
] as const) {
  const snap = await answer(await startSession(deps, exam.id), 8);
  logTime(db, 'session', { goalId: exam.id, sessionId: snap.id, nodeId: snap.current?.nodeId ?? null }, minutes * 60, daysAgo(days));
  await abandonSession(deps, snap.id);
  db.prepare('UPDATE sessions SET started_at = ?, ended_at = ? WHERE id = ?').run(daysAgo(days, 18).toISOString(), daysAgo(days).toISOString(), snap.id);
}
const maker = new SessionMaker();
const made = await maker.make(deps, { description: 'How attention works in a transformer', goalId: null });
const free = await answer(await startFreeSession(deps, maker, { goalId: null, counted: false, proposalId: made.id, addFirst: ['n1'] }), 6);
logTime(db, 'free', { goalId: null, sessionId: free.id, nodeId: free.current?.nodeId ?? null }, 25 * 60, daysAgo(2));
await abandonSession(deps, free.id);
db.prepare('UPDATE sessions SET started_at = ?, ended_at = ? WHERE id = ?').run(daysAgo(2, 18).toISOString(), daysAgo(2).toISOString(), free.id);
logTime(db, 'practice', { goalId: exam.id }, 15 * 60, daysAgo(1));

// flashcards for hard facts, some reviewed
const cards = [
  { front: 'State the condition for a Nash equilibrium', back: '$u_i(s_i, s_{-i}) \\ge u_i(s_i\', s_{-i})$ for every player $i$ and every $s_i\'$.', node: 'nash' },
  { front: 'What is a strictly dominated strategy?', back: 'One that another strategy beats against every choice of the others.', node: 'dominated' },
  { front: 'What does IESDS stand for?', back: 'Iterated elimination of strictly dominated strategies.', node: 'iesds' },
  { front: 'What is a best response?', back: 'A strategy with the highest payoff given what the others play.', node: 'bestResponse' },
  { front: 'Define a strategy profile', back: 'A list of one strategy for each player.', node: 'profile' },
];
for (const [i, c] of cards.entries()) {
  const card = saveCard(db, { front: c.front, back: c.back, nodeIds: [id(c.node)], goalId: exam.id });
  if (i < 3) reviewCard(db, card.id, 3, daysAgo(4 - i));
}
refreshGoalFields(db);

// a draft whose map is drawn and waits for approval, and an addition waiting on the pricing goal
const draft = createGoalFromForm(db, { text: 'Understand how sequential games are solved', budget: { mode: 'total', hours: 6 }, wantedLevel: null, context: null, materials: [] }, { draft: true });
addCapabilities(db, draft.id, [{ statement: 'Can solve a small game tree by backward induction', targets: ['subgame', 'backwardInduction', 'spe'].map((k) => ({ nodeId: id(k), depth: 2 as const, core: k === 'backwardInduction' })) }]);
markCompiled(db, draft.id, 'Sequential games', [], { level: 'working', scope: 'Solve small game trees and explain why threats must be credible.' });
requestAddition(db, pricing.id, 'How a firm that moves first can shape the price');
const adding = new FakeProvider({
  goalCompiler: () => ({
    fits: true,
    reason: null,
    shape: 'deep',
    capabilities: [{ statement: 'Can explain how moving first changes a price war', targets: [{ ref: 'm1', depth: 2, core: true }, { ref: 'm2', depth: 2, core: false }] }],
    newNodes: [
      { tempId: 'm1', kind: 'claim', name: 'Price leadership', statement: 'A firm that sets its price first shapes the best response of the firm that follows.' },
      { tempId: 'm2', kind: 'claim', name: 'Commitment changes the game', statement: 'Moving first and committing can change which outcome is stable.' },
    ],
  }),
});
await proposeAddition({ db, provider: adding }, pricing.id);
refreshGoalFields(db);

// two misconceptions from earlier answers: one open (and one clean answer since), one that ended
afterAnswer(db, id('bestResponse'), 'Thinks a best response must be best against every strategy of the other player.', daysAgo(6).toISOString());
recordEvidence(db, { nodeId: id('bestResponse'), kind: 'check', score: 0.9, reasoning: 'clean', at: daysAgo(5).toISOString() });
afterAnswer(db, id('payoff'), 'Reads a payoff pair as (column, row).', daysAgo(10).toISOString());
for (const d of [9, 8]) recordEvidence(db, { nodeId: id('payoff'), kind: 'check', score: 0.9, reasoning: 'clean', at: daysAgo(d).toISOString() });
afterAnswer(db, id('payoff'), null, daysAgo(8).toISOString());

// the learner's note on an idea and an example they asked for in an earlier session, for the goal's notes
saveNote(db, id('nash'), 'Check each cell in turn: hold the other firm fixed, then ask whether moving pays.');
const pastSession = listEndedSessions(db, exam.id, 1)[0];
if (pastSession) {
  appendSessionEvent(db, pastSession.id, 'aside', {
    nodeId: id('nash'),
    stage: 'explain',
    mode: 'example',
    question: '',
    answer: 'Two cafés on one street both charge 3 euros. If either raises to 4 it loses its customers to the other, and dropping to 2 loses money on every cup: neither gains by moving alone, so (3, 3) is stable.',
  });
}

// a mock exam under way, one problem answered and graded in the background (`--exam`)
if (flags.includes('--exam')) {
  const examProvider = new FakeProvider({
    problemGenerator: (req: CompleteRequest<unknown>) => {
      const specs = [...(req.messages[0]?.content ?? '').matchAll(/### Problem (\d+)/g)].map((m) => Number(m[1]));
      const statements = [
        'Two firms set prices of 10 or 15. Payoffs are (40, 40), (10, 60), (60, 10) and (25, 25). Which pairs of prices are stable, and why?',
        'Player 1 chooses Top or Bottom, then player 2 sees it and chooses Left or Right. Find the outcome a rational pair would reach.',
        'In a game where one strategy beats another whatever the opponent does, what can you remove first, and what is left?',
      ];
      return { problems: specs.map((index) => ({ index, statement: statements[index % statements.length] as string, solution: 'Check each player in turn, holding the other fixed: only (10, 10) survives, since either firm gains by undercutting a price of 15.', rubric: ['checks both players', 'names the stable pair'] })) };
    },
    grader: (req: CompleteRequest<unknown>) => {
      const ids = [...(req.messages[0]?.content ?? '').matchAll(/- \[(node_[a-z0-9_]+)\]/g)].map((m) => m[1] as string);
      return { score: 7, feedback: 'You found the stable pair and checked one firm; check the other as well.', ideas: ids.map((nodeId) => ({ nodeId, score: 7 })), misconception: null };
    },
  });
  const examDeps = { db, provider: examProvider };
  const mock = await startPractice(examDeps, exam.id, { kind: 'mock', maxProblems: 3 });
  if (mock?.problems[0]) submitPracticeAnswer(examDeps, mock.problems[0].id, 'Low, low: neither firm gains by raising its price alone.', 0.66);
  await settleGrading();
}

// an oral exam on the exam goal, two questions in (`--talk`)
if (flags.includes('--talk')) {
  const questions = ['Say in your own words what makes a pair of strategies a Nash equilibrium.', 'Good. Now suppose one firm can commit to its price first. Does the same pair stay stable, and why?'];
  const examiner = new FakeProvider({ examiner: [{ say: questions[0], done: false, verdict: null }, { say: questions[1], done: false, verdict: null }] });
  const talk = await startDialogue({ db, provider: examiner }, exam.id, 'oral');
  await answerDialogue({ db, provider: examiner }, talk.id, 'Each player is already playing a best response to the other, so neither gains by changing alone.');
}

// a watched course folder with a Word document and a notebook, looked through when the app starts (`--watch`)
if (flags.includes('--watch')) {
  const course = join(folder, 'Course folder');
  mkdirSync(course, { recursive: true });
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const p = (text: string, style = '') => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
  const docx = zipSync({ 'word/document.xml': strToU8(`<w:document ${W}><w:body>${p('Lecture 6: Repeated games', 'Title')}${p('Why cooperation can last', 'Heading1')}${p('In a game played again and again, the threat of punishment tomorrow can keep players cooperating today.')}</w:body></w:document>`) });
  writeFileSync(join(course, 'Lecture 6.docx'), docx);
  writeFileSync(join(course, 'Price war.ipynb'), JSON.stringify({ cells: [{ cell_type: 'markdown', source: '# Simulating a price war' }, { cell_type: 'code', source: 'prices = [10, 15]' }] }));
  addWatchedFolder(db, course, null);
}

// an open session at its recall, which opens with the question the last session left (`--recall`)
if (flags.includes('--recall')) {
  // the sandbox's earlier sessions were ended early; the last one is given the close it would have had
  const last = listEndedSessions<SessionState>(db, exam.id, 1)[0];
  if (last) saveSessionState(db, last.id, { ...last.state, closing: { canDo: 'You can find equilibria in small games and say why they hold.', previewQuestion: 'What changes when one player moves first?', recall: [] } });
  await startSession(deps, exam.id);
}

// an open session at its first explanation (which shows the lecture's figure), past the recall and the orientation
if (flags.includes('--open-session')) {
  let open = await startSession(deps, exam.id);
  for (let i = 0; i < 3 && open.phase !== 'teach'; i += 1) open = await respond(deps, open.id, { answer: '' });
  if (open.card?.stage === 'predict') await respond(deps, open.id, { answer: 'Each firm would undercut the other until neither gains from moving alone.', confidence: 0.33 });
}
db.close();
console.log(`sandbox ready: FRONTIER_USER_DATA=${folder} npx electron-vite dev --remoteDebuggingPort 9333`);
