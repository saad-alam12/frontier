/** Oral exams and teach-backs: the conversation as it went, and its verdict once it ended. */
import type { Database } from './db';
import { nowIso, parseJson } from './db';
import { newId } from './ids';

export type DialogueKind = 'oral' | 'teach';

export interface DialogueTurn {
  who: 'examiner' | 'learner';
  text: string;
}

export interface DialogueVerdict {
  summary: string;
  ideas: { nodeId: string; score: number; note: string }[];
}

export interface DialogueRecord {
  id: string;
  goalId: string | null;
  kind: DialogueKind;
  nodeIds: string[];
  turns: DialogueTurn[];
  verdict: DialogueVerdict | null;
  status: 'open' | 'done';
  createdAt: string;
}

interface Row {
  id: string;
  goal_id: string | null;
  kind: DialogueKind;
  node_ids: string;
  turns: string;
  verdict: string | null;
  status: 'open' | 'done';
  created_at: string;
}

const toRecord = (r: Row): DialogueRecord => ({
  id: r.id,
  goalId: r.goal_id,
  kind: r.kind,
  nodeIds: parseJson<string[]>(r.node_ids, []),
  turns: parseJson<DialogueTurn[]>(r.turns, []),
  verdict: r.verdict ? parseJson<DialogueVerdict | null>(r.verdict, null) : null,
  status: r.status,
  createdAt: r.created_at,
});

export function createDialogue(db: Database, input: { goalId: string | null; kind: DialogueKind; nodeIds: string[]; turns: DialogueTurn[] }): DialogueRecord {
  const id = newId('dlg');
  const at = nowIso();
  db.prepare('INSERT INTO dialogues (id, goal_id, kind, node_ids, turns, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, input.goalId, input.kind, JSON.stringify(input.nodeIds), JSON.stringify(input.turns), at);
  return { id, goalId: input.goalId, kind: input.kind, nodeIds: input.nodeIds, turns: input.turns, verdict: null, status: 'open', createdAt: at };
}

export function getDialogue(db: Database, id: string): DialogueRecord | null {
  const row = db.prepare('SELECT * FROM dialogues WHERE id = ?').get(id) as Row | undefined;
  return row ? toRecord(row) : null;
}

export function saveDialogue(db: Database, dialogue: DialogueRecord): void {
  db.prepare('UPDATE dialogues SET turns = ?, verdict = ?, status = ? WHERE id = ?').run(JSON.stringify(dialogue.turns), dialogue.verdict ? JSON.stringify(dialogue.verdict) : null, dialogue.status, dialogue.id);
}

/** A goal's newest conversation still open, so one left half-way is picked up again. */
export function openDialogue(db: Database, goalId: string): DialogueRecord | null {
  const row = db.prepare("SELECT * FROM dialogues WHERE status = 'open' AND goal_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(goalId) as Row | undefined;
  return row ? toRecord(row) : null;
}
