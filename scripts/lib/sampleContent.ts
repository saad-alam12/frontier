/**
 * The sandbox's sample content (R8 E4): counting and adding, which anyone knows, so checking the app
 * never needs real study. A short lecture PDF and a page of notes state the ideas; the ideas, their
 * chains and a worked example go in through the merge plan, cited to the pages that state them.
 * The game theory graph in `backend/store/seed/exampleGraph.ts` stays for the tests.
 */
import { planMerge } from '../../backend/core/merge';
import type { ExtractedChain, ExtractedExample, ExtractedNode } from '../../backend/core/merge';
import type { Database } from '../../backend/store/db';
import { transaction } from '../../backend/store/db';
import { addCoverage, createSource, updateSourceStatus } from '../../backend/store/sources';
import { listChains, listNodes } from '../../backend/store/world';
import { applyMergePlan } from '../../backend/store/worldWrites';

type Idea = [key: string, kind: ExtractedNode['kind'], name: string, statement: string, page: string];

/** The lecture's four pages, as lines: a title, then what the page says. Page 4 is mostly a figure. */
export const LECTURE_TITLE = 'Lecture 1: Counting and adding';
export const LECTURE_PAGES: string[][] = [
  ['Lecture 1: Counting and adding', 'Numbers for everyday use'],
  ['Counting', 'A whole number counts things: 0, 1, 2, 3 and so on.', 'To count, say the numbers in order, one for each thing.', 'The last number you say is how many there are.'],
  ['Adding', 'The sign + means put two amounts together.', 'To add 2 + 3, start at 2 and count on three steps: 3, 4, 5.', 'The result is called the sum. Adding 0 changes nothing.', 'The order does not matter: 2 + 3 = 3 + 2.'],
  ['Even and odd', 'Figure: dots in pairs.'],
];

/** Ideas the lecture states, with the page that states them. */
const LECTURE_IDEAS: Idea[] = [
  ['number', 'term', 'Whole number', 'A whole number counts things: 0, 1, 2, 3 and so on.', 'p2'],
  ['counting', 'procedure', 'Counting', 'Say the numbers in order, one for each thing; the last number said is how many there are.', 'p2'],
  ['plus', 'term', 'Plus sign', 'The sign + means put two amounts together: 2 + 3 means 2 and 3 more.', 'p3'],
  ['adding', 'procedure', 'Adding two numbers', 'Start at the first number and count on by the second: 2 + 3 is three steps on from 2, which is 5.', 'p3'],
  ['sum', 'term', 'Sum', 'The result of adding numbers: the sum of 2 and 3 is 5.', 'p3'],
  ['zero', 'claim', 'Adding zero changes nothing', 'Any number plus 0 is the same number: 7 + 0 = 7.', 'p3'],
  ['order', 'claim', 'Order does not matter when adding', 'Swapping the numbers gives the same sum: 2 + 3 = 3 + 2 = 5.', 'p3'],
  ['grouping', 'claim', 'Grouping does not matter when adding', 'Three numbers can be added in any pairs: (1 + 2) + 3 = 1 + (2 + 3) = 6.', 'p3'],
  ['even', 'term', 'Even number', 'A whole number whose things pair up with none left over: 0, 2, 4, 6.', 'p4'],
  ['odd', 'term', 'Odd number', 'A whole number that leaves one over when its things are paired up: 1, 3, 5, 7.', 'p4'],
  ['evenPlusEven', 'claim', 'Even plus even is even', 'Two numbers that each pair up add to a number that pairs up: 2 + 4 = 6.', 'p4'],
  ['oddPlusOdd', 'claim', 'Odd plus odd is even', 'The two left-over ones make a pair, so the sum is even: 3 + 5 = 8.', 'p4'],
  ['doubling', 'procedure', 'Doubling', 'Add a number to itself: double 4 is 4 + 4 = 8. A double is always even.', 'p4'],
];

/** The notes source: one part per page, and the ideas it states. */
export const NOTES_TITLE = 'Notes: taking away, making ten, and Python';
export const NOTES_PARTS = [
  { locator: 'p1', text: 'Taking away is adding backwards. The sign − means take an amount away: 5 − 2 is 3. If 2 + 3 = 5, then 5 − 3 = 2.' },
  { locator: 'p2', text: 'To add 8 + 5, fill up to ten first: 8 + 2 = 10, then the 3 that are left make 13. Making ten works for any sum that goes past ten.' },
  { locator: 'p3', text: 'In Python, a + b adds two numbers and sum([1, 2, 3]) adds a list. The remainder n % 2 is 0 for an even number and 1 for an odd one.' },
];
const NOTES_IDEAS: Idea[] = [
  ['minus', 'term', 'Taking away', 'The sign − means take an amount away: 5 − 2 is 3.', 'p1'],
  ['undo', 'claim', 'Taking away undoes adding', 'If 2 + 3 = 5, then 5 − 3 = 2: taking away is adding backwards.', 'p1'],
  ['tens', 'procedure', 'Making ten', 'Add by filling up to ten first: 8 + 5 is 8 + 2 = 10, then 3 more, 13.', 'p2'],
  ['pyAdd', 'procedure', 'Adding in Python', 'In Python, a + b adds two numbers, and sum([a, b, c]) adds a list of them.', 'p3'],
  ['pyEven', 'procedure', 'Even or odd in Python', 'In Python, n % 2 is 0 when n is even and 1 when n is odd.', 'p3'],
];

/** What builds on what: the premises together are what an idea needs. */
const CHAINS: [premises: string[], conclusion: string][] = [
  [['number'], 'counting'],
  [['counting', 'plus'], 'adding'],
  [['adding'], 'sum'],
  [['adding', 'number'], 'zero'],
  [['adding'], 'order'],
  [['adding', 'order'], 'grouping'],
  [['number', 'counting'], 'even'],
  [['number', 'counting'], 'odd'],
  [['even', 'adding'], 'evenPlusEven'],
  [['odd', 'adding'], 'oddPlusOdd'],
  [['adding', 'even'], 'doubling'],
  [['counting'], 'minus'],
  [['adding', 'minus'], 'undo'],
  [['adding', 'number'], 'tens'],
  [['adding'], 'pyAdd'],
  [['even', 'odd'], 'pyEven'],
];

const EXAMPLES: ExtractedExample[] = [{ illustrates: 'tens', title: '8 + 5 by making ten', body: '8 needs 2 more to make 10. Take 2 from the 5: 8 + 2 = 10. The 3 left over make 13. So 8 + 5 = 13.', locator: 'p2' }];

export interface SampleIds {
  /** The idea id of each key above ("adding", "even", …). */
  ideas: Map<string, string>;
  lectureId: string;
  notesId: string;
}

/**
 * Store the two sources and their ideas, chains and worked example, as reading them would (marked
 * read). The lecture's stored copy, a real PDF, is written by the caller (the sandbox), so the source
 * viewer can draw it.
 */
export function seedSample(db: Database, lecturePath: string): SampleIds {
  return transaction(db, () => {
    const lecture = createSource(db, { kind: 'pdf', title: LECTURE_TITLE, path: lecturePath, hash: 'sample-lecture-1' }, [
      { text: LECTURE_PAGES.map((lines, i) => `[p${i + 1}]\n${lines.join('\n')}`).join('\n\n'), locator: `p1–p${LECTURE_PAGES.length}` },
    ]);
    const notes = createSource(db, { kind: 'markdown', title: NOTES_TITLE, path: null, hash: 'sample-notes-1' }, NOTES_PARTS);
    let counter = 0;
    const newId = (prefix: 'node' | 'chain' | 'example') => `${prefix}_sample_${String(++counter).padStart(3, '0')}`;
    const ideas = new Map<string, string>();
    const merge = (sourceId: string, list: Idea[], examples: ExtractedExample[] = []) => {
      const keys = new Set(list.map(([key]) => key));
      // a premise read from the other source is already an idea: it is named by its id
      const ref = (key: string) => (keys.has(key) ? key : (ideas.get(key) as string));
      const extractedNodes: ExtractedNode[] = list.map(([tempId, kind, name, statement, locator]) => ({ tempId, kind, name, statement, aliases: [], locator }));
      const extractedChains: ExtractedChain[] = CHAINS.filter(([, conclusion]) => keys.has(conclusion)).map(([premises, conclusion]) => ({ premises: premises.map(ref), conclusion, locator: list.find(([key]) => key === conclusion)?.[4] }));
      const plan = planMerge({
        sourceId,
        extractedNodes,
        extractedChains,
        extractedExamples: examples,
        identities: new Map(),
        existingNodes: new Map(listNodes(db).map((n) => [n.id, n])),
        existingChains: listChains(db),
        newId,
      });
      applyMergePlan(db, plan);
      addCoverage(db, sourceId, plan.coveredNodeIds);
      plan.newNodes.forEach((n, i) => ideas.set(list[i]?.[0] as string, n.id));
      updateSourceStatus(db, sourceId, { status: 'done' });
    };
    merge(lecture.id, LECTURE_IDEAS);
    merge(notes.id, NOTES_IDEAS, EXAMPLES);
    db.prepare('UPDATE sources SET chunks_done = chunk_count WHERE id IN (?, ?)').run(lecture.id, notes.id);
    return { ideas, lectureId: lecture.id, notesId: notes.id };
  });
}

/** Flashcards for the facts to know by heart, each with the idea it is about. */
export const SAMPLE_CARDS = [
  { front: 'What is 2 + 3?', back: '5', idea: 'adding' },
  { front: 'What is 7 + 0?', back: '7. Adding zero changes nothing.', idea: 'zero' },
  { front: 'What is an even number?', back: 'A whole number whose things pair up with none left over: 0, 2, 4, 6.', idea: 'even' },
  { front: 'What is double 4?', back: '$4 + 4 = 8$', idea: 'doubling' },
  { front: 'In Python, what does `7 % 2` give?', back: '`1`, so 7 is odd.', idea: 'pyEven' },
];

/** The mock exam's questions and their solution: trivial on purpose. */
export const EXAM_PROBLEMS = ['What is 2 + 3? Say how you got it.', 'Is 7 even or odd? Say how you know.', 'What is 8 + 5? Show how making ten helps.'];
export const EXAM_SOLUTION = 'Count on from the first number: 2 + 3 = 5. Seven things pair up as three pairs and one left over, so 7 is odd. 8 + 2 = 10, and the 3 left make 13.';

/** What the fake tutor says about one idea: a few ideas have their own cards, the rest are written from the idea's name and statement. */
export interface IdeaCards {
  predict: string;
  explain: string;
  check: { question: string; answerKey: string };
  right: string;
  close: string;
  use: { task: string; answerKey: string; starter?: string };
}

const OWN_CARDS: Record<string, IdeaCards> = {
  'Adding two numbers': {
    predict: 'You have 2 apples and someone gives you 3 more. How many apples do you have now?',
    explain: '## Counting on\n\nTo add $2 + 3$, start at **2** and count on three steps: 3, 4, **5**. So $2 + 3 = 5$, and 5 is the **sum**.\n\nYou never count the number you start from: the first step is the next number.',
    check: { question: 'What is 4 + 3? Say how you counted.', answerKey: '7' },
    right: 'Right: 7. You started at 4 and counted on three.',
    close: 'Close, but you counted the 4 itself. Start counting at the next number: 5, 6, 7.',
    use: { task: 'Write a Python function `add(a, b)` that returns the sum, and check that `add(2, 3)` gives 5.', answerKey: 'return a + b', starter: 'def add(a, b):\n    ...\n\nprint(add(2, 3))\n' },
  },
  'Taking away': {
    predict: 'You have 5 sweets and eat 2. How many are left?',
    explain: '## Taking away\n\nThe sign $-$ means take an amount away. It is counting backwards: for $5 - 2$, start at **5** and count back two steps: 4, **3**. So $5 - 2 = 3$, and taking away less than you have always leaves a whole number.',
    check: { question: 'What is 7 − 3? Check your answer by adding.', answerKey: '4, since 4 + 3 = 7' },
    right: 'Right: 4, and 4 + 3 = 7 checks it.',
    close: 'Close, but count back from 7: 6, 5, 4. Then check: 4 + 3 = 7.',
    use: { task: 'There are 9 birds on a fence and 4 fly away. How many are left? Write it as a take-away.', answerKey: '9 − 4 = 5' },
  },
  'Even number': {
    predict: 'Can 6 socks be put into pairs with none left over? And 7 socks?',
    explain: '## Even numbers\n\nPair up the things. If none is left over, the number is **even**: 6 socks make 3 pairs. If one is left over, it is odd: 7 socks make 3 pairs and 1 sock.',
    check: { question: 'Is 10 even or odd? Say how you know.', answerKey: 'even: 5 pairs, none left over' },
    right: 'Right: 10 is 5 pairs with none left over, so it is even.',
    close: 'Close, but pair them up: 10 makes 5 pairs with none left over, so it is even.',
    use: { task: 'Write a Python function `is_even(n)` that says whether `n` is even, and try it on 4 and 7.', answerKey: 'return n % 2 == 0', starter: 'def is_even(n):\n    ...\n\nprint(is_even(4), is_even(7))\n' },
  },
};

/** The fake tutor's cards for an idea, found by its name. */
export function cardsFor(name: string, statement: string): IdeaCards {
  return (
    OWN_CARDS[name] ?? {
      predict: `Before we start: what do you think "${name}" means? A guess is fine.`,
      explain: `## ${name}\n\n${statement}`,
      check: { question: `In your own words, what is "${name}"? Give one small example with numbers.`, answerKey: statement },
      right: 'Right, and your example shows it.',
      close: 'Close, but add a small example with numbers to show it.',
      use: { task: `Make up one small example of "${name}" with numbers, and work it out.`, answerKey: statement },
    }
  );
}
