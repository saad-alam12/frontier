import { describe, expect, it } from 'vitest';
import { openDatabase } from '../store/db';
import { addCapabilities, createGoal, markCompiled } from '../store/goals';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { recordEvidence, setOwnStatement } from './evidence';
import { saveCard } from './cards';
import { exportGoalNotes } from './notes';

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
