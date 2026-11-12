/**
 * Oral exams and teach-backs (design §5.2, "Talking it through"): a conversation about a few ideas the
 * learner has learned, with the examiner's "why" and "what if", or a beginner the learner teaches. At
 * the end the examiner scores each idea from what the learner said, and that is evidence like an answer.
 */
import { runExaminer } from '../agents/examiner';
import { recallProbability } from '../core/fsrs';
import { partialStringField } from '../core/partialJson';
import { OWNED_DEPTH } from '../core/types';
import type { LlmProvider } from '../llm/provider';
import type { Database } from '../store/db';
import { transaction } from '../store/db';
import { createDialogue, getDialogue, openDialogue, saveDialogue } from '../store/dialogues';
import type { DialogueKind, DialogueRecord, DialogueVerdict } from '../store/dialogues';
import { getGoal, listTargets } from '../store/goals';
import { afterAnswer } from './bugs';
import { recordEvidence } from './evidence';
import { loadKnowledge, refreshGoalFields } from './knowledge';

/** Ideas a conversation is about: enough to explore, few enough to go deep. */
const IDEAS = 3;
/** Answers before the examiner must give the verdict. */
const MAX_ANSWERS = 8;

export interface DialogueDeps {
  db: Database;
  provider: LlmProvider;
  /** The examiner's turn as it is written. */
  onWriting?: (dialogueId: string, text: string) => void;
}

export interface DialogueView {
  id: string;
  kind: DialogueKind;
  goalId: string | null;
  goalTitle: string;
  ideas: { nodeId: string; name: string }[];
  turns: DialogueRecord['turns'];
  status: 'open' | 'done';
  verdict: DialogueVerdict | null;
  answersLeft: number;
}

export function dialogueView(db: Database, id: string): DialogueView {
  const dialogue = getDialogue(db, id);
  if (!dialogue) throw new Error('This conversation is no longer there.');
  const view = loadKnowledge(db);
  const goal = dialogue.goalId ? getGoal(db, dialogue.goalId) : undefined;
  const answers = dialogue.turns.filter((t) => t.who === 'learner').length;
  return {
    id: dialogue.id,
    kind: dialogue.kind,
    goalId: dialogue.goalId,
    goalTitle: goal?.title ?? goal?.text ?? '',
    ideas: dialogue.nodeIds.map((nodeId) => ({ nodeId, name: view.nodes.get(nodeId)?.name ?? nodeId })),
    turns: dialogue.turns,
    status: dialogue.status,
    verdict: dialogue.verdict,
    answersLeft: Math.max(0, MAX_ANSWERS - answers),
  };
}

/** The goal's conversation left open, if any. */
export function openDialogueView(db: Database, goalId: string): DialogueView | null {
  const open = openDialogue(db, goalId);
  return open ? dialogueView(db, open.id) : null;
}

/**
 * Start one on a goal: the goal's learned ideas that are fading most (an oral exam asks what is
 * slipping; a teach-back is best on what is not yet firm), up to three. Refused before any is learned.
 */
export async function startDialogue(deps: DialogueDeps, goalId: string, kind: DialogueKind, now = new Date()): Promise<DialogueView> {
  const { db } = deps;
  const goal = getGoal(db, goalId);
  if (!goal) throw new Error('unknown goal');
  const view = loadKnowledge(db, now);
  const learned = [...new Set(listTargets(db, goalId).map((t) => t.nodeId))].filter((id) => view.nodes.has(id) && (view.states.get(id)?.depth ?? 0) >= OWNED_DEPTH);
  if (learned.length === 0) throw new Error('Learn a few ideas of this goal in a session first. Then there is something to talk through.');
  const recall = (id: string) => {
    const state = view.states.get(id);
    return state ? recallProbability(state.fsrs, now) : 1;
  };
  const nodeIds = learned.sort((a, b) => recall(a) - recall(b) || a.localeCompare(b)).slice(0, IDEAS);
  const dialogue = createDialogue(db, { goalId, kind, nodeIds, turns: [] });
  const first = await runExaminer(deps.provider, { kind, goal: goalFrame(goal), ideas: ideasOf(db, nodeIds), turns: [], finish: false }, writer(deps, dialogue.id));
  dialogue.turns.push({ who: 'examiner', text: first.say ?? 'Tell me about the first idea in your own words.' });
  saveDialogue(db, dialogue);
  return dialogueView(db, dialogue.id);
}

/** The learner's answer; the examiner follows up, or ends with the verdict. */
export async function answerDialogue(deps: DialogueDeps, id: string, answer: string): Promise<DialogueView> {
  const dialogue = openOne(deps.db, id);
  dialogue.turns.push({ who: 'learner', text: answer });
  const answers = dialogue.turns.filter((t) => t.who === 'learner').length;
  await nextTurn(deps, dialogue, answers >= MAX_ANSWERS);
  return dialogueView(deps.db, id);
}

/** End it now: the verdict on what was said so far. With nothing said, it just closes. */
export async function endDialogue(deps: DialogueDeps, id: string): Promise<DialogueView> {
  const dialogue = openOne(deps.db, id);
  if (!dialogue.turns.some((t) => t.who === 'learner')) {
    dialogue.status = 'done';
    saveDialogue(deps.db, dialogue);
    return dialogueView(deps.db, id);
  }
  await nextTurn(deps, dialogue, true);
  return dialogueView(deps.db, id);
}

async function nextTurn(deps: DialogueDeps, dialogue: DialogueRecord, finish: boolean): Promise<void> {
  const { db } = deps;
  const goal = dialogue.goalId ? getGoal(db, dialogue.goalId) : undefined;
  const turn = await runExaminer(deps.provider, { kind: dialogue.kind, goal: goal ? goalFrame(goal) : { text: 'Learning for its own sake', level: null, context: null }, ideas: ideasOf(db, dialogue.nodeIds), turns: dialogue.turns, finish }, writer(deps, dialogue.id));
  if (!turn.done || !turn.verdict) {
    dialogue.turns.push({ who: 'examiner', text: turn.say ?? '' });
    saveDialogue(db, dialogue);
    return;
  }
  const verdict = turn.verdict;
  transaction(db, () => {
    dialogue.verdict = verdict;
    dialogue.status = 'done';
    saveDialogue(db, dialogue);
    // what the learner said is evidence like an answer: an oral exam is practice, a teach-back explains
    for (const idea of verdict.ideas) {
      recordEvidence(db, {
        nodeId: idea.nodeId,
        kind: dialogue.kind === 'oral' ? 'practice' : 'explain',
        score: idea.score / 10,
        reasoning: idea.note,
        context: { step: dialogue.kind, dialogueId: dialogue.id },
      });
      afterAnswer(db, idea.nodeId, null);
    }
    refreshGoalFields(db);
  });
}

function openOne(db: Database, id: string): DialogueRecord {
  const dialogue = getDialogue(db, id);
  if (!dialogue) throw new Error('This conversation is no longer there.');
  if (dialogue.status !== 'open') throw new Error('This conversation has ended.');
  return dialogue;
}

function goalFrame(goal: { text: string; level: DialogueGoalLevel; context: string | null }) {
  return { text: goal.text, level: goal.level, context: goal.context };
}
type DialogueGoalLevel = Parameters<typeof runExaminer>[1]['goal']['level'];

function ideasOf(db: Database, nodeIds: string[]) {
  const view = loadKnowledge(db);
  return nodeIds.map((id) => ({ id, name: view.nodes.get(id)?.name ?? id, statement: view.nodes.get(id)?.statement ?? '', ownStatement: view.states.get(id)?.ownStatement ?? null }));
}

function writer(deps: DialogueDeps, id: string): ((json: string) => void) | undefined {
  const onWriting = deps.onWriting;
  if (!onWriting) return undefined;
  return (json) => {
    const say = partialStringField(json, 'say');
    if (say) onWriting(id, say);
  };
}
