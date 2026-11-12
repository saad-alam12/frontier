/**
 * A goal's notes (design §10, "Notes"): gathered from the store for the notes view, the cheat sheet and
 * the Markdown export (core/notes.ts), and the learner's free note on an idea.
 */
import { cheatSheet, goalNotes, notesFileName, reachedWord } from '../core/notes';
import type { CheatSheet } from '../core/notes';
import { recallProbability } from '../core/fsrs';
import { getNode, getNodes } from '../store/world';
import { getState } from '../store/evidence';
import { cardsForNodes } from '../store/cards';
import { getGoal, listCapabilities, listTargets } from '../store/goals';
import { ideaNotesFor, saveIdeaNote } from '../store/ideaNotes';
import { workedExamplesFor } from '../store/sessions';
import type { Database } from '../store/db';

/** Worked examples kept per idea in the notes: the newest. */
const EXAMPLES = 2;
/** A free note is the learner's own text, at most this long. */
export const NOTE_CHARS = 4000;

export interface NoteIdeaView {
  nodeId: string;
  name: string;
  statement: string;
  reached: string | null;
  ownWords: string | null;
  handle: string | null;
  note: string | null;
  examples: string[];
  cards: { front: string; back: string }[];
  /** Already written out under an earlier skill. */
  repeat: boolean;
}

export interface GoalNotesView {
  goalId: string;
  title: string;
  text: string;
  context: string | null;
  scope: string | null;
  skills: { statement: string; ideas: NoteIdeaView[] }[];
}

export interface CheatSheetView extends CheatSheet {
  goalId: string;
  title: string;
}

interface Gathered {
  goal: NonNullable<ReturnType<typeof getGoal>>;
  title: string;
  skills: { statement: string; ideas: (NoteIdeaView & { core: boolean; learned: boolean; recall: number | null })[] }[];
}

/** Skills in their order, ideas deepest first, everything the learner made of each idea. */
function gather(db: Database, goalId: string, now: Date): Gathered {
  const goal = getGoal(db, goalId);
  if (!goal) throw new Error('That goal no longer exists.');
  const targets = listTargets(db, goalId, { all: true });
  const nodeIds = [...new Set(targets.map((t) => t.nodeId))];
  const nodes = getNodes(db, nodeIds);
  const cards = cardsForNodes(db, nodeIds);
  const notes = ideaNotesFor(db, nodeIds);
  const examples = new Map<string, string[]>();
  for (const e of workedExamplesFor(db, nodeIds)) {
    const list = examples.get(e.nodeId) ?? [];
    if (list.length < EXAMPLES) examples.set(e.nodeId, [...list, e.markdown]);
  }
  const written = new Set<string>();
  const skills = listCapabilities(db, goalId).map((cap) => ({
    statement: cap.statement,
    ideas: targets
      .filter((t) => t.capabilityId === cap.id && nodes.has(t.nodeId))
      .sort((a, b) => b.idealDepth - a.idealDepth)
      .map((t) => {
        const node = nodes.get(t.nodeId) as NonNullable<ReturnType<typeof nodes.get>>;
        const state = getState(db, t.nodeId);
        const repeat = written.has(t.nodeId);
        written.add(t.nodeId);
        const learned = (state?.depth ?? 0) > 0;
        return {
          nodeId: t.nodeId,
          name: node.name,
          statement: node.statement,
          reached: reachedWord(state?.depth ?? 0),
          ownWords: state?.ownStatement ?? null,
          handle: state?.handle ?? null,
          note: notes.get(t.nodeId) ?? null,
          examples: examples.get(t.nodeId) ?? [],
          cards: cards.filter((c) => c.nodeIds.includes(t.nodeId)).map((c) => ({ front: c.front, back: c.back })),
          repeat,
          core: t.core,
          learned,
          recall: learned && state ? recallProbability(state.fsrs, now) : null,
        };
      }),
  }));
  return { goal, title: goal.title ?? goal.text, skills };
}

/** The notes view of a goal. */
export function goalNotesView(db: Database, goalId: string, now = new Date()): GoalNotesView {
  const { goal, title, skills } = gather(db, goalId, now);
  return {
    goalId,
    title,
    text: goal.text,
    context: goal.context,
    scope: goal.scope,
    skills: skills.map((s) => ({ statement: s.statement, ideas: s.ideas.map(({ core: _core, learned: _learned, recall: _recall, ...idea }) => idea) })),
  };
}

/** The goal on one page, or everything with `all`. */
export function cheatSheetView(db: Database, goalId: string, options: { all?: boolean } = {}, now = new Date()): CheatSheetView {
  const { title, skills } = gather(db, goalId, now);
  return { goalId, title, ...cheatSheet(skills, options) };
}

/** The goal as Markdown, with the file name to suggest. */
export function exportGoalNotes(db: Database, goalId: string, now = new Date()): { fileName: string; markdown: string } {
  const { goal, title, skills } = gather(db, goalId, now);
  const exportedOn = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return { fileName: notesFileName(title), markdown: goalNotes({ title, text: goal.text, context: goal.context, scope: goal.scope, skills, exportedOn }) };
}

/** Save the learner's note on an idea; an empty note removes it. */
export function saveNote(db: Database, nodeId: string, text: string): { nodeId: string; note: string | null } {
  if (!getNode(db, nodeId)) throw new Error('That idea is no longer on your map.');
  if (text.length > NOTE_CHARS) throw new Error(`A note can be at most ${NOTE_CHARS} characters.`);
  saveIdeaNote(db, nodeId, text);
  return { nodeId, note: text.trim() ? text : null };
}

/** The learner's note on one idea. */
export function noteFor(db: Database, nodeId: string): string | null {
  return ideaNotesFor(db, [nodeId]).get(nodeId) ?? null;
}
