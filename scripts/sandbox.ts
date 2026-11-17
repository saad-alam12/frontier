/**
 * Build a sandbox for screenshots and manual checks, through the real services and the fake model (no
 * network): `npx tsx scripts/sandbox.ts <sandbox folder> [flags]`. Its content is counting and adding
 * (`scripts/lib/sampleContent.ts`), trivially simple on purpose: checking the app should never need
 * real study. Two goals (an arithmetic quiz with a date, and even and odd numbers with no time limit),
 * a draft to approve, an addition to review, a four-page lecture PDF with a figure and a page of notes,
 * past sessions with two misconceptions, a free session, flashcards and a note.
 *
 * Flags: `--open-session` (a session open at its first explanation), `--recall` (a session open at its
 * recall, which opens with the question the last one left), `--exam` (a mock exam under way), `--talk`
 * (an oral exam two questions in, and a teach-back), `--drawings` (a diagram and a plot in the
 * explanation), `--watch` (a watched course folder with a Word document and a notebook).
 *
 * The folder gets a settings.json whose data folder is `<sandbox>/data`; start the app on it with
 * `FRONTIER_USER_DATA=<sandbox folder> npx electron-vite dev --remoteDebuggingPort 9333`. Model calls
 * in the app fail at once (API provider, no key), so screens with a model call show their error state.
 * Never point it at the learner's data: the folder is wiped first.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { saveImageFile } from '../backend/store/attachments';
import { describeFigure, listFigures, setFigurePicture, syncFigurePages } from '../backend/store/figures';
import { addWatchedFolder } from '../backend/store/watchedFolders';
import { FakeProvider } from '../backend/llm/FakeProvider';
import { stageAsked } from '../backend/llm/fakeTutor';
import type { CompleteRequest } from '../backend/llm/provider';
import { openDatabase } from '../backend/store/db';
import type { Database } from '../backend/store/db';
import { logTime } from '../backend/store/activity';
import { addCapabilities, markCompiled } from '../backend/store/goals';
import { approveGoalPlan, createGoalFromForm } from '../backend/services/goals';
import { reviewCard, saveCard } from '../backend/services/cards';
import { recordEvidence } from '../backend/services/evidence';
import { refreshGoalFields } from '../backend/services/knowledge';
import { abandonSession, respond, startSession } from '../backend/services/session';
import type { SessionSnapshot } from '../backend/services/sessionView';
import type { SessionState } from '../backend/services/sessionState';
import { startFreeSession } from '../backend/services/freeSession';
import { proposeAddition, requestAddition } from '../backend/services/addition';
import { SessionMaker } from '../backend/services/sessionMaker';
import { SessionWork } from '../backend/services/sessionWork';
import { settleGrading, startPractice, submitPracticeAnswer } from '../backend/services/practice';
import { answerDialogue, startDialogue } from '../backend/services/dialogue';
import { saveNote } from '../backend/services/notes';
import { afterAnswer } from '../backend/services/bugs';
import { appendSessionEvent, listEndedSessions, saveSessionState } from '../backend/store/sessions';
import { makePdf } from './lib/tinyPdf';
import { EXAM_PROBLEMS, EXAM_SOLUTION, LECTURE_PAGES, SAMPLE_CARDS, cardsFor, seedSample } from './lib/sampleContent';

const [folderArg, ...flags] = process.argv.slice(2);
if (!folderArg) {
  console.error('usage: tsx scripts/sandbox.ts <sandbox folder> [--open-session] [--recall] [--exam] [--talk] [--drawings] [--watch]');
  process.exit(2);
}
const folder = resolve(folderArg);
if (folder.includes(`${join('Frontier')}`) && !folder.includes('sandbox')) throw new Error('refusing a folder that looks like real data');
rmSync(folder, { recursive: true, force: true });
const dataFolder = join(folder, 'data');
mkdirSync(dataFolder, { recursive: true });
// the API provider with no key: the app in the sandbox never reaches a real model (calls fail at once)
writeFileSync(join(folder, 'settings.json'), JSON.stringify({ dataFolder, provider: 'anthropicApi', apiKey: '' }, null, 2));

/** A diagram and a plot for the explanation (`--drawings`), as the tutor may draw them. */
const DRAWINGS = [
  '',
  '',
  'Counting on, one step at a time:',
  '',
  '```mermaid',
  'flowchart LR',
  '  A["Start at 2"] --> B["3"]',
  '  B --> C["4"]',
  '  C --> D["5: the sum"]',
  '```',
  '',
  'Adding 3 moves every number up by 3:',
  '',
  '```plot',
  '{"title": "Adding 3", "x": {"label": "the number", "min": 0, "max": 8}, "y": {"label": "the number + 3", "min": 0, "max": 12}, "curves": [{"label": "x + 3", "y": "x + 3"}], "points": [{"x": 2, "y": 5, "label": "2 + 3 = 5"}]}',
  '```',
].join('\n');

/** A tutor that writes a plain card for every stage and grades from a cycle of scores. */
function tutor(scores: number[]) {
  let i = 0;
  return (req: CompleteRequest<unknown>) => {
    const text = req.messages[0]?.content ?? '';
    if (req.submit.name === 'submit_recall') {
      const ids = [...text.matchAll(/- \[(node_[a-z0-9_]+)\]/g)].map((m) => m[1]);
      const closing = /add the closing summary/.test(text);
      return { recalled: ids.map((nodeId) => ({ nodeId, score: 0.8, note: 'Named it and gave an example.' })), canDo: closing ? 'You can add small numbers by counting on, and say why the order does not matter.' : null, previewQuestion: closing ? 'What is 9 + 6, if you fill up to ten first?' : null };
    }
    const grading = /Grade the response/.test(text);
    // "No idea" scores low, as the real tutor would; any other answer takes the next score of the cycle
    const noIdea = /## Learner's response\n\(empty: the learner has no idea\)/.test(text);
    const score = noIdea ? 0.1 : (scores[i++ % scores.length] ?? 0.8);
    const next = stageAsked(text, grading ? score : null);
    // the cards follow the idea being taught, read from the task
    const idea = /^## Node .*\n\[node_[a-z0-9_]+\] (.+) \((?:claim|procedure|term)\)\n(.+)$/m.exec(text);
    const say = cardsFor(idea?.[1] ?? 'Adding two numbers', idea?.[2] ?? '');
    // shows the idea's figure when it has one, as the real tutor may
    const figure = /## Figures you can show[\s\S]*?^- \[(fig_[a-z0-9]+)\]/m.exec(text)?.[1];
    const grade = grading ? { score, feedback: score >= 0.7 ? say.right : say.close, misconception: null, confidentlyWrong: false, missingBackground: null } : null;
    const cards: Record<string, unknown> = {
      predict: { stage: 'predict', prompt: say.predict },
      explain: {
        stage: 'explain',
        markdown: `${say.explain}${figure ? `\n\n![Two rows of dots in pairs: 4 and 5](figure:${figure})\n\nCount the dots on to add them, cross some out to take away, and pair them up to see whether a number is even or odd.` : ''}${flags.includes('--drawings') ? DRAWINGS : ''}`,
      },
      check: { stage: 'check', question: say.check.question, answerKey: say.check.answerKey, rubric: ['gives the right answer', 'says how'] },
      derive: { stage: 'derive', prompt: 'Why does this hold? Show it by counting.', answerKey: say.check.answerKey, rubric: ['counts it out', 'says why'] },
      connect: { stage: 'connect', prompt: 'Say one link between this idea and counting.' },
      compress: { stage: 'compress', prompt: 'In your own words, at most two sentences.' },
      use: { stage: 'use', task: say.use.task, answerKey: say.use.answerKey, rubric: ['gets it right', 'shows the steps'], code: say.use.starter ? { language: 'python', starter: say.use.starter } : null },
      index: { stage: 'index', gist: idea?.[2] ?? 'The sum is what you get when you add numbers.', placement: 'It comes right after counting and adding.', question: say.check.question, answerKey: say.check.answerKey },
      support: { stage: 'support', markdown: 'Worked example: for 4 + 3, put your finger on 4, then say 5, 6, 7. The last number you say is the answer.' },
      reteach: { stage: 'reteach', markdown: 'Think of a number line: adding 3 is three hops to the right, taking away 3 is three hops to the left.' },
    };
    return { grade, card: next ? cards[next] : null };
  };
}

function planner(req: CompleteRequest<unknown>) {
  const text = (req.messages[0]?.content ?? '').split('## Candidates')[1] ?? '';
  // adding first when it is a candidate: its cards and the lecture's figure make the plainest first explanation
  const lines = [...text.matchAll(/^- \[(node_[a-z0-9_]+)\](.*)$/gm)].sort((a, b) => Number(/Adding two numbers/.test(b[2] ?? '')) - Number(/Adding two numbers/.test(a[2] ?? '')));
  const ids = lines.map((m) => m[1] as string);
  return { title: 'Counting on and the sum', orientation: 'Today you add by counting on, then learn what the answer is called.', steps: ids.slice(0, 3).map((nodeId) => ({ nodeId, why: 'The quiz asks you to add small numbers.' })) };
}

const sessionPlanner = {
  title: 'Adding bigger numbers',
  summary: 'Adding two-digit numbers by tens and ones.',
  level: 'intuition',
  ideas: [{ ref: 'n2', aim: 2, why: 'It is what you asked about.' }],
  newIdeas: [
    { tempId: 'n1', kind: 'term', name: 'Tens and ones', statement: 'A two-digit number is some tens and some ones: 23 is 2 tens and 3 ones.', premises: [] },
    { tempId: 'n2', kind: 'claim', name: 'Adding tens and ones', statement: 'Add the tens, add the ones, then put them together: 23 + 14 = 37.', premises: ['n1'] },
  ],
  background: [],
};

/** A PNG of dots in pairs, 4 above and 5 below, standing in for a page picture (the sandbox has no browser to draw pages). */
function dotsPicture(width = 900, height = 560): Buffer {
  const dots = [
    ...[0, 1, 2, 3].map((i) => ({ x: 200 + Math.floor(i / 2) * 150, y: 150 + (i % 2) * 90 })),
    ...[0, 1, 2, 3, 4].map((i) => ({ x: 200 + Math.floor(i / 2) * 150, y: 370 + (i % 2) * 90 })),
  ];
  const ink = (x: number, y: number) => dots.some((d) => Math.hypot(x - d.x, y - d.y) < 28) || (Math.abs(y - 290) < 2 && x > 120 && x < 780);
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
const work = new SessionWork();
const deps = { db, provider, work };
const now = new Date();
const daysAgo = (days: number, hour = 19) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, hour, 10);

// the lecture (a real PDF, so the source viewer draws it and its text can be selected) and the notes
mkdirSync(join(dataFolder, 'sources'), { recursive: true });
writeFileSync(join(dataFolder, 'sources', 'sample-lecture-1.pdf'), makePdf(LECTURE_PAGES));
const sample = seedSample(db, 'sample-lecture-1.pdf');
const id = (key: string) => {
  const found = sample.ideas.get(key);
  if (!found) throw new Error(`no sample idea ${key}`);
  return found;
};
// page 4 is mostly a figure: its picture shows two rows of dots in pairs
syncFigurePages(db, sample.lectureId, [{ page: 4, locator: 'p4' }]);
const dotsFigure = listFigures(db, sample.lectureId)[0];
if (dotsFigure) {
  setFigurePicture(db, dotsFigure.id, { file: saveImageFile(join(dataFolder, 'figures'), dotsPicture(), 'image/png'), width: 900, height: 560 });
  describeFigure(db, dotsFigure.id, 'Two rows of dots, 4 and 5, set out in pairs: counting them on adds them, crossing some out takes away, and pairing them up shows that 4 is even and 5 is odd.', [id('adding'), id('minus'), id('even'), id('odd')]);
}

// what the learner brought: whole numbers, counting and the plus sign
for (const key of ['number', 'counting', 'plus']) recordEvidence(db, { nodeId: id(key), kind: 'explain', score: 0.95, reasoning: 'probe', at: daysAgo(14).toISOString() });

const materials = [
  { sourceId: sample.lectureId, role: 'teaching' as const },
  { sourceId: sample.notesId, role: 'teaching' as const },
];
const sources = materials.map((m) => m.sourceId);
// a goal with a date three weeks away, a written quiz and a fixed time
const quizDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 21).toISOString().slice(0, 10);
const quiz = createGoalFromForm(db, { text: 'Pass the arithmetic quiz', kind: 'course', assessment: 'written_exam', date: quizDate, budget: { mode: 'total', hours: 6 }, wantedLevel: null, context: 'A short quiz on adding small numbers. I learn best from examples.', materials }, { draft: true });
addCapabilities(db, quiz.id, [
  { statement: 'Can add two small numbers by counting on', targets: ['adding', 'sum', 'zero', 'order'].map((k) => ({ nodeId: id(k), depth: k === 'adding' ? (3 as const) : (2 as const), core: k === 'adding' })) },
  { statement: 'Can add past ten by making ten', targets: ['grouping', 'tens'].map((k) => ({ nodeId: id(k), depth: 2 as const })) },
  { statement: 'Can take away by adding backwards', targets: ['minus', 'undo'].map((k) => ({ nodeId: id(k), depth: 2 as const })) },
]);
markCompiled(db, quiz.id, 'Arithmetic quiz', sources, { level: 'working', scope: 'Add and take away small numbers by hand, and explain how, as the quiz asks.' });
approveGoalPlan(db, quiz.id);

// a goal with no time limit, at working depth, with two ideas that are natural in Python
const parity = createGoalFromForm(db, { text: 'Understand even and odd numbers', budget: null, wantedLevel: 'working', context: 'For checking numbers in small Python programs.', focus: ['concepts', 'practice'], materials }, { draft: true });
addCapabilities(db, parity.id, [{ statement: 'Can tell even from odd, by hand and in Python', targets: ['even', 'odd', 'evenPlusEven', 'oddPlusOdd', 'pyEven'].map((k) => ({ nodeId: id(k), depth: 2 as const, core: k === 'even' })) }]);
markCompiled(db, parity.id, 'Even and odd', sources, { level: 'working', scope: 'Tell even from odd numbers, say what happens when you add them, and check it in Python.' });
approveGoalPlan(db, parity.id);
refreshGoalFields(db);

/** What the learner answers about an idea, plainly. */
const REPLIES: Record<string, string> = {
  'Adding two numbers': '7: I started at 4 and counted on 5, 6, 7.',
  'Taking away': '4: I counted back from 7, and 4 + 3 = 7 checks it.',
  Sum: 'The sum is the answer when you add: 2 + 3 has the sum 5.',
  'Even number': 'Even: 10 makes 5 pairs with none left over.',
};
const GUESSES: Record<string, string> = {
  'Adding two numbers': 'Five apples: two and three more.',
  'Taking away': 'Three sweets are left.',
  'Even number': '6 socks pair up; 7 leave one sock over.',
};
const reply = (snap: SessionSnapshot) => {
  const name = snap.current?.name ?? '';
  if (snap.card?.stage === 'predict') return GUESSES[name] ?? 'A guess: it has to do with counting.';
  return REPLIES[name] ?? 'I counted it out one step at a time: it makes 5.';
};

/** Answer cards while the session teaches, at most `cards` of them. */
async function answer(snap: SessionSnapshot, cards: number): Promise<SessionSnapshot> {
  let s = await respond(deps, snap.id, { answer: '' });
  for (let i = 0; i < cards && s.phase === 'teach'; i += 1) s = await respond(deps, s.id, { answer: reply(s), confidence: 0.66 });
  return s;
}

// three earlier planned sessions on the quiz, a free session, and study time over two weeks
for (const [days, minutes] of [
  [12, 35],
  [9, 50],
  [5, 42],
] as const) {
  const snap = await answer(await startSession(deps, quiz.id), 8);
  logTime(db, 'session', { goalId: quiz.id, sessionId: snap.id, nodeId: snap.current?.nodeId ?? null }, minutes * 60, daysAgo(days));
  await abandonSession(deps, snap.id);
  db.prepare('UPDATE sessions SET started_at = ?, ended_at = ? WHERE id = ?').run(daysAgo(days, 18).toISOString(), daysAgo(days).toISOString(), snap.id);
}
const maker = new SessionMaker();
const made = await maker.make(deps, { description: 'How to add bigger numbers, like 23 + 14', goalId: null });
const free = await answer(await startFreeSession(deps, maker, { goalId: null, counted: false, proposalId: made.id, addFirst: ['n1'] }), 6);
logTime(db, 'free', { goalId: null, sessionId: free.id, nodeId: free.current?.nodeId ?? null }, 25 * 60, daysAgo(2));
await abandonSession(deps, free.id);
db.prepare('UPDATE sessions SET started_at = ?, ended_at = ? WHERE id = ?').run(daysAgo(2, 18).toISOString(), daysAgo(2).toISOString(), free.id);
logTime(db, 'practice', { goalId: quiz.id }, 15 * 60, daysAgo(1));

// even and odd learned earlier, so the second goal has something to talk through
for (const key of ['even', 'odd']) recordEvidence(db, { nodeId: id(key), kind: 'explain', score: 0.9, reasoning: 'Paired up the dots and said what was left over.', at: daysAgo(7).toISOString() });

// flashcards for the facts to know by heart, some reviewed
for (const [i, c] of SAMPLE_CARDS.entries()) {
  const card = saveCard(db, { front: c.front, back: c.back, nodeIds: [id(c.idea)], goalId: ['even', 'pyEven'].includes(c.idea) ? parity.id : quiz.id });
  if (i < 3) reviewCard(db, card.id, 3, daysAgo(4 - i));
}
refreshGoalFields(db);

// a draft whose map is drawn and waits for approval, and an addition waiting on the even and odd goal
const draft = createGoalFromForm(db, { text: 'Learn to take away', budget: { mode: 'total', hours: 3 }, wantedLevel: null, context: null, materials: [] }, { draft: true });
addCapabilities(db, draft.id, [{ statement: 'Can take away small numbers', targets: ['minus', 'undo'].map((k) => ({ nodeId: id(k), depth: 2 as const, core: k === 'minus' })) }]);
markCompiled(db, draft.id, 'Taking away', [], { level: 'working', scope: 'Take away small numbers and check the answer by adding.' });
requestAddition(db, parity.id, 'How doubling always gives an even number');
const adding = new FakeProvider({
  goalCompiler: () => ({
    fits: true,
    reason: null,
    shape: 'deep',
    capabilities: [{ statement: 'Can explain why a double is always even', targets: [{ ref: 'm1', depth: 2, core: true }, { ref: 'm2', depth: 2, core: false }] }],
    newNodes: [
      { tempId: 'm1', kind: 'claim', name: 'A double is even', statement: 'Adding a number to itself makes pairs, so the result is always even: 3 + 3 = 6.' },
      { tempId: 'm2', kind: 'procedure', name: 'Halving', statement: 'Split an even number into two equal parts: half of 8 is 4.' },
    ],
  }),
});
await proposeAddition({ db, provider: adding }, parity.id);
refreshGoalFields(db);

// two misconceptions from earlier answers: one open (and one clean answer since), one that ended
afterAnswer(db, id('adding'), 'Counts the starting number when counting on, so says 4 + 3 is 6.', daysAgo(6).toISOString());
recordEvidence(db, { nodeId: id('adding'), kind: 'check', score: 0.9, reasoning: 'clean', at: daysAgo(5).toISOString() });
afterAnswer(db, id('zero'), 'Thinks adding 0 makes a number bigger by one.', daysAgo(10).toISOString());
for (const d of [9, 8]) recordEvidence(db, { nodeId: id('zero'), kind: 'check', score: 0.9, reasoning: 'clean', at: daysAgo(d).toISOString() });
afterAnswer(db, id('zero'), null, daysAgo(8).toISOString());

// the learner's note on an idea and an example they asked for in an earlier session, for the goal's notes
saveNote(db, id('adding'), 'Put a finger on the first number, then count on. Do not count the first number again.');
const pastSession = listEndedSessions(db, quiz.id, 1)[0];
if (pastSession) {
  appendSessionEvent(db, pastSession.id, 'aside', {
    nodeId: id('adding'),
    stage: 'explain',
    mode: 'example',
    question: '',
    answer: 'You have 5 sweets and a friend gives you 2. Start at 5 and count on two: 6, 7. You have 7 sweets.',
  });
}

// a mock exam under way, one problem answered and graded in the background (`--exam`)
if (flags.includes('--exam')) {
  const examProvider = new FakeProvider({
    problemGenerator: (req: CompleteRequest<unknown>) => {
      const specs = [...(req.messages[0]?.content ?? '').matchAll(/### Problem (\d+)/g)].map((m) => Number(m[1]));
      return { problems: specs.map((index) => ({ index, statement: EXAM_PROBLEMS[index % EXAM_PROBLEMS.length] as string, solution: EXAM_SOLUTION, rubric: ['gives the right number', 'says how'] })) };
    },
    grader: (req: CompleteRequest<unknown>) => {
      const ids = [...(req.messages[0]?.content ?? '').matchAll(/- \[(node_[a-z0-9_]+)\]/g)].map((m) => m[1] as string);
      return { score: 9, feedback: 'Right: 5. You counted on from 2.', ideas: ids.map((nodeId) => ({ nodeId, score: 9 })), misconception: null };
    },
  });
  const examDeps = { db, provider: examProvider };
  const mock = await startPractice(examDeps, quiz.id, { kind: 'mock', maxProblems: 3 });
  if (mock?.problems[0]) submitPracticeAnswer(examDeps, mock.problems[0].id, '5. I started at 2 and counted on 3, 4, 5.', 0.9);
  await settleGrading();
  // the sandbox's exam gets two hours, so it is still under way when the checks reach it (a real one has about twelve minutes a problem)
  if (mock) db.prepare('UPDATE practice_sets SET minutes = 120 WHERE id = ?').run(mock.id);
}

// an oral exam on the quiz, two questions in, and a teach-back on even and odd (`--talk`)
if (flags.includes('--talk')) {
  const questions = ['In your own words, how do you add 4 + 3?', 'Good. Why does 3 + 4 give the same answer?'];
  const examiner = new FakeProvider({ examiner: [{ say: questions[0], done: false, verdict: null }, { say: questions[1], done: false, verdict: null }] });
  const talk = await startDialogue({ db, provider: examiner }, quiz.id, 'oral');
  await answerDialogue({ db, provider: examiner }, talk.id, 'Start at 4 and count on three: 5, 6, 7. So it is 7.');
  const beginner = new FakeProvider({ examiner: [{ say: 'I am new to this. What does it mean for a number to be even?', done: false, verdict: null }] });
  await startDialogue({ db, provider: beginner }, parity.id, 'teach');
}

// a watched course folder with a Word document and a notebook, looked through when the app starts (`--watch`)
if (flags.includes('--watch')) {
  const course = join(folder, 'Course folder');
  mkdirSync(course, { recursive: true });
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const p = (text: string, style = '') => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
  const docx = zipSync({ 'word/document.xml': strToU8(`<w:document ${W}><w:body>${p('Lesson 2: Taking away', 'Title')}${p('Adding backwards', 'Heading1')}${p('Taking away undoes adding: if 2 + 3 = 5, then 5 take away 3 is 2.')}</w:body></w:document>`) });
  writeFileSync(join(course, 'Lesson 2.docx'), docx);
  writeFileSync(join(course, 'Even and odd.ipynb'), JSON.stringify({ cells: [{ cell_type: 'markdown', source: '# Even or odd in Python' }, { cell_type: 'code', source: 'for n in range(6):\n    print(n, n % 2 == 0)' }] }));
  addWatchedFolder(db, course, null);
}

// an open session at its recall, which opens with the question the last session left (`--recall`)
if (flags.includes('--recall')) {
  // the sandbox's earlier sessions were ended early; the last one is given the close it would have had
  const last = listEndedSessions<SessionState>(db, quiz.id, 1)[0];
  if (last) saveSessionState(db, last.id, { ...last.state, closing: { canDo: 'You can add small numbers by counting on, and say why the order does not matter.', previewQuestion: 'What is 9 + 6, if you fill up to ten first?', recall: [] } });
  await startSession(deps, quiz.id);
}

// an open session at an explanation (which shows the lecture's figure), past the recall and the orientation:
// it continues the idea the last session left half-done, then says "no idea" to a prediction
if (flags.includes('--open-session')) {
  let open = await startSession(deps, quiz.id);
  for (let i = 0; i < 3 && open.phase !== 'teach'; i += 1) open = await respond(deps, open.id, { answer: '' });
  for (let i = 0; i < 8 && open.phase === 'teach' && open.card?.stage !== 'explain'; i += 1) open = await respond(deps, open.id, { answer: open.card?.stage === 'predict' ? '' : reply(open), confidence: 0.66 });
}
db.close();
console.log(`sandbox ready: FRONTIER_USER_DATA=${folder} npx electron-vite dev --remoteDebuggingPort 9333`);
