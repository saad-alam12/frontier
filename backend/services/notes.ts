/** A goal's notes, gathered from the store for `goalNotes` (core/notes.ts). */
import { goalNotes, notesFileName, reachedWord } from '../core/notes';
import { getNodes } from '../store/world';
import { getState } from '../store/evidence';
import { cardsForNodes } from '../store/cards';
import { getGoal, listCapabilities, listTargets } from '../store/goals';
import type { Database } from '../store/db';

/** The goal as Markdown, with the file name to suggest. Skills in their order, ideas deepest first. */
export function exportGoalNotes(db: Database, goalId: string, now = new Date()): { fileName: string; markdown: string } {
  const goal = getGoal(db, goalId);
  if (!goal) throw new Error('That goal no longer exists.');
  const targets = listTargets(db, goalId, { all: true });
  const nodes = getNodes(db, targets.map((t) => t.nodeId));
  const cards = cardsForNodes(db, [...nodes.keys()]);
  const title = goal.title ?? goal.text;
  const skills = listCapabilities(db, goalId).map((cap) => ({
    statement: cap.statement,
    ideas: targets
      .filter((t) => t.capabilityId === cap.id && nodes.has(t.nodeId))
      .sort((a, b) => b.idealDepth - a.idealDepth)
      .map((t) => {
        const node = nodes.get(t.nodeId) as NonNullable<ReturnType<typeof nodes.get>>;
        const state = getState(db, t.nodeId);
        return {
          name: node.name,
          statement: node.statement,
          reached: reachedWord(state?.depth ?? 0),
          ownWords: state?.ownStatement ?? null,
          handle: state?.handle ?? null,
          cards: cards.filter((c) => c.nodeIds.includes(t.nodeId)).map((c) => ({ front: c.front, back: c.back })),
        };
      }),
  }));
  const exportedOn = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return { fileName: notesFileName(title), markdown: goalNotes({ title, text: goal.text, context: goal.context, scope: goal.scope, skills, exportedOn }) };
}
