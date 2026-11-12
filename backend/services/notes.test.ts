import { describe, expect, it } from 'vitest';
import { openDatabase } from '../store/db';
import { addCapabilities, createGoal, markCompiled } from '../store/goals';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { recordEvidence, setOwnStatement } from './evidence';
import { saveCard } from './cards';
import { cheatSheetView, exportGoalNotes, goalNotesView, noteFor, saveNote } from './notes';
import { appendSessionEvent, createSession } from '../store/sessions';
import { eraseFromMap } from './erase';

describe('exporting a goal as notes', () => {
  it('gathers the goal, its ideas, what the learner wrote and their cards', () => {
    const db = openDatabase(':memory:');
    const ids = seedExampleGraph(db);
    const id = (k: string) => ids.get(k) as string;
    const goal = createGoal(db, { text: 'Pass the game theory exam', context: 'Written exam in December.' });
    addCapabilities(db, goal.id, [{ statement: 'Can find Nash equilibria', targets: [{ nodeId: id('nash'), depth: 3 }, { nodeId: id('bestResponse'), depth: 2 }] }]);
    markCompiled(db, goal.id, 'Game theory exam', [], { scope: 'Solve small games.' });
    recordEvidence(db, { nodeId: id('nash'), kind: 'explain', score: 0.9, reasoning: 't' });
    setOwnStatement(db, id('nash'), 'Nobody gains by moving alone.', 'the standoff');
    saveCard(db, { front: 'Define a Nash equilibrium', back: 'No profitable deviation.', nodeIds: [id('nash')] });

    const { fileName, markdown } = exportGoalNotes(db, goal.id, new Date(2026, 10, 7));
    expect(fileName).toBe('Game theory exam.md');
    expect(markdown).toContain('# Game theory exam\n\nPass the game theory exam');
    expect(markdown).toContain('Exported from Frontier on 7 November 2026.');
    expect(markdown).toContain('## Can find Nash equilibria');
    expect(markdown.indexOf('### Nash equilibrium')).toBeLessThan(markdown.indexOf('### Best response'));
    expect(markdown).toContain('**In my words:** Nobody gains by moving alone.');
    expect(markdown).toContain('**Handle:** the standoff');
    expect(markdown).toContain('- **Q:** Define a Nash equilibrium');
    expect(() => exportGoalNotes(db, 'goal_missing')).toThrow(/no longer exists/);
  });
});

function setup() {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const id = (k: string) => ids.get(k) as string;
  const goal = createGoal(db, { text: 'Pass the game theory exam' });
  addCapabilities(db, goal.id, [
    { statement: 'Can find Nash equilibria', targets: [{ nodeId: id('nash'), depth: 3, core: true }, { nodeId: id('bestResponse'), depth: 2 }] },
    { statement: 'Can use dominance', targets: [{ nodeId: id('nash'), depth: 2 }, { nodeId: id('dominant'), depth: 2 }] },
  ]);
  markCompiled(db, goal.id, 'Game theory exam', []);
  return { db, id, goal };
}

describe('the notes view', () => {
  it('shows each idea once with the learner\u2019s note and the worked examples they were shown', () => {
    const { db, id, goal } = setup();
    saveNote(db, id('nash'), 'Check the corners of the table first.');
    const session = createSession(db, goal.id, {});
    appendSessionEvent(db, session.id, 'card', { nodeId: id('nash'), stage: 'support', card: { stage: 'support', markdown: 'Worked: at (10, 10) neither firm gains by raising.' } });
    appendSessionEvent(db, session.id, 'aside', { nodeId: id('nash'), stage: 'check', mode: 'example', question: '', answer: 'Another: two drivers on a narrow road.' });
    appendSessionEvent(db, session.id, 'aside', { nodeId: id('nash'), stage: 'check', mode: 'hint', question: '', answer: 'Not an example.' });

    const view = goalNotesView(db, goal.id);
    const [first, second] = view.skills;
    const nash = first?.ideas.find((i) => i.nodeId === id('nash'));
    expect(nash?.note).toBe('Check the corners of the table first.');
    expect(nash?.examples).toHaveLength(2);
    expect(nash?.examples.join(' ')).not.toContain('Not an example');
    expect(nash?.repeat).toBe(false);
    expect(second?.ideas.find((i) => i.nodeId === id('nash'))?.repeat).toBe(true);

    const markdown = exportGoalNotes(db, goal.id).markdown;
    expect(markdown).toContain('**My note**\n\nCheck the corners of the table first.');
    expect(markdown).toContain('**Worked example**');
  });

  it('puts the goal on one page, the core idea first', () => {
    const { db, id, goal } = setup();
    const sheet = cheatSheetView(db, goal.id, {});
    expect(sheet.title).toBe('Game theory exam');
    expect(sheet.skills.flatMap((s) => s.ideas.map((i) => i.nodeId))).toEqual([id('nash'), id('bestResponse'), id('dominant')]);
    expect(sheet.left).toBe(0);
  });

  it('saves, clears and refuses notes, and an erased idea takes its note with it', () => {
    const { db, id } = setup();
    expect(saveNote(db, id('nash'), 'Mine.')).toEqual({ nodeId: id('nash'), note: 'Mine.' });
    expect(noteFor(db, id('nash'))).toBe('Mine.');
    expect(saveNote(db, id('nash'), '   ').note).toBeNull();
    expect(noteFor(db, id('nash'))).toBeNull();
    expect(() => saveNote(db, 'node_missing', 'x')).toThrow(/no longer on your map/);
    expect(() => saveNote(db, id('nash'), 'x'.repeat(4001))).toThrow(/at most 4000/);

    saveNote(db, id('dominant'), 'About to go.');
    eraseFromMap({ db, sourcesDir: '/nowhere', figuresDir: '/nowhere', isReading: () => false }, { scope: 'ideas', ids: [id('dominant')] });
    expect(db.prepare('SELECT COUNT(*) AS n FROM idea_notes WHERE node_id = ?').get(id('dominant'))).toEqual({ n: 0 });
  });
});
