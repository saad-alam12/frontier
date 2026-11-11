/**
 * Trails (design §8): every session as a timeline that can be replayed: the plan, the recall, each
 * card with the learner's answer and grade, finished ideas, practice, the close. Rebuilt from
 * session events; answer keys and rubrics never leave the backend.
 */
import type { Grade, LearnerResponse, TutorCard } from '../agents/tutor';
import type { Stage } from '../core/session';
import type { Database } from '../store/db';
import { listEvidenceForSession } from '../store/evidence';
import { getGoal } from '../store/goals';
import { answerFor, getProblem } from '../store/practice';
import { getSession, listSessionEvents, listSessions } from '../store/sessions';
import type { SessionRecord } from '../store/sessions';
import { loadKnowledge } from './knowledge';
import { publicCard } from './session';
import type { Aside, FreeSession, PublicCard, SessionState } from './session';

export interface TrailSummary {
  id: string;
  goalId: string | null;
  goalTitle: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  status: SessionRecord['status'];
  /** Ideas finished in this session. */
  ideas: string[];
  answers: number;
  /** For a session the learner chose: what they asked for (their words, or the ideas they picked). */
  asked: Asked | null;
}

export type Asked = Pick<FreeSession, 'description' | 'picked'>;

export type TrailItem =
  | { id: string; at: string; type: 'plan'; title: string; orientation: string; ideas: string[]; resumed: string | null; asked: Asked | null }
  | { id: string; at: string; type: 'recall'; text: string; recalled: { name: string; score: number }[] }
  | { id: string; at: string; type: 'step'; idea: string; stage: Stage; card: PublicCard; asides: Aside[]; response: LearnerResponse | null; grade: Grade | null; carried: boolean }
  | { id: string; at: string; type: 'idea-done'; idea: string; score: number | null }
  | { id: string; at: string; type: 'practice'; statement: string; answer: string; solution: string; score: number | null; feedback: string | null }
  | { id: string; at: string; type: 'pause' }
  | { id: string; at: string; type: 'close'; text: string; canDo: string; preview: string }
  | { id: string; at: string; type: 'end'; status: 'done' | 'abandoned' };

export interface Trail {
  summary: TrailSummary;
  items: TrailItem[];
}

function summarize(db: Database, s: SessionRecord<SessionState>): TrailSummary {
  const goal = s.goalId ? getGoal(db, s.goalId) : undefined;
  const steps = s.state.plan?.steps ?? [];
  return {
    id: s.id,
    goalId: s.goalId,
    goalTitle: goal?.title ?? goal?.text ?? '',
    title: s.state.plan?.title ?? 'Session',
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    status: s.status,
    ideas: steps.filter((st) => s.state.nodeStatus?.[st.nodeId] === 'done').map((st) => st.name),
    answers: listSessionEvents(db, s.id).filter((e) => e.kind === 'response' || e.kind === 'practice-answer').length,
    asked: askedIn(s.state),
  };
}

function askedIn(state: SessionState): Asked | null {
  return state.free ? { description: state.free.description, picked: state.free.picked } : null;
}

/** Sessions newest first; with `nodeId`, only sessions that taught or tested that idea. */
export function listTrails(db: Database, nodeId?: string): TrailSummary[] {
  return listSessions<SessionState>(db, 500)
    .filter((s) => !nodeId || s.state.plan?.steps?.some((st) => st.nodeId === nodeId) || listEvidenceForSession(db, s.id).some((e) => e.nodeId === nodeId))
    .map((s) => summarize(db, s));
}

export function trail(db: Database, sessionId: string): Trail {
  const session = getSession<SessionState>(db, sessionId);
  if (!session) throw new Error(`unknown session ${sessionId}`);
  const view = loadKnowledge(db);
  // erased ideas keep the names the session recorded, so the trail still reads
  const name = (id: string | undefined) =>
    id ? (view.nodes.get(id)?.name ?? session.state.plan?.steps?.find((st) => st.nodeId === id)?.name ?? session.state.previousNodes?.find((n) => n.id === id)?.name ?? id) : '';
  const items: TrailItem[] = [];
  const open = new Map<string, Extract<TrailItem, { type: 'step' }>>();
  for (const e of listSessionEvents(db, sessionId)) {
    const p = e.payload as {
      nodeId?: string;
      stage?: Stage;
      card?: TutorCard;
      response?: LearnerResponse;
      grade?: Grade;
      mode?: Aside['mode'];
      question?: string;
      answer?: string;
      carriedFrom?: string;
      text?: string;
      recalled?: { nodeId: string; score: number }[];
      closing?: { canDo: string; previewQuestion: string };
      problemId?: string;
      resumes?: { nodeId: string } | null;
    };
    const base = { id: e.id, at: e.at };
    switch (e.kind) {
      case 'start':
        items.push({ ...base, type: 'plan', title: session.state.plan?.title ?? 'Session', orientation: session.state.plan?.orientation ?? '', ideas: (session.state.plan?.steps ?? []).map((st) => st.name), resumed: p.resumes ? name(p.resumes.nodeId) : null, asked: askedIn(session.state) });
        break;
      case 'reconstruct':
        items.push({ ...base, type: 'recall', text: p.text ?? '', recalled: (p.recalled ?? []).map((r) => ({ name: name(r.nodeId), score: r.score })) });
        break;
      case 'card': {
        const card = publicCard(p.card ?? null);
        if (!card || !p.stage || !p.nodeId) break;
        const item: Extract<TrailItem, { type: 'step' }> = { ...base, type: 'step', idea: name(p.nodeId), stage: p.stage, card, asides: [], response: null, grade: null, carried: Boolean(p.carriedFrom) };
        items.push(item);
        open.set(`${p.nodeId}:${p.stage}`, item);
        break;
      }
      case 'aside': {
        // what the learner asked the tutor while the card was open
        const item = open.get(`${p.nodeId}:${p.stage}`);
        if (item && p.mode && typeof p.answer === 'string') item.asides.push({ id: e.id, mode: p.mode, question: p.question ?? '', answer: p.answer });
        break;
      }
      case 'response': {
        const item = open.get(`${p.nodeId}:${p.stage}`);
        if (item && p.response) {
          item.response = p.response;
          item.grade = p.grade ?? null;
          open.delete(`${p.nodeId}:${p.stage}`);
        }
        break;
      }
      case 'node-done': {
        const graded = items.filter((i): i is Extract<TrailItem, { type: 'step' }> => i.type === 'step' && i.idea === name(p.nodeId) && i.grade !== null);
        const score = graded.length ? graded.reduce((s, i) => s + (i.grade?.score ?? 0), 0) / graded.length : null;
        items.push({ ...base, type: 'idea-done', idea: name(p.nodeId), score });
        break;
      }
      case 'practice-answer': {
        const problem = p.problemId ? getProblem(db, p.problemId) : undefined;
        const answer = p.problemId ? answerFor(db, p.problemId) : undefined;
        if (problem && answer) items.push({ ...base, type: 'practice', statement: problem.statement, answer: answer.answer, solution: problem.solution, score: answer.score === null ? null : Math.round(answer.score * 100) / 10, feedback: answer.feedback });
        break;
      }
      case 'pause':
        items.push({ ...base, type: 'pause' });
        break;
      case 'close':
        items.push({ ...base, type: 'close', text: p.text ?? '', canDo: p.closing?.canDo ?? '', preview: p.closing?.previewQuestion ?? '' });
        break;
      case 'finish':
        items.push({ ...base, type: 'end', status: 'done' });
        break;
      case 'abandon':
        items.push({ ...base, type: 'end', status: 'abandoned' });
        break;
    }
  }
  // the open card of an unfinished session is where it stands, not history
  const stepItems = items.filter((i) => i.type === 'step');
  const last = stepItems[stepItems.length - 1];
  const cleaned = session.status === 'active' && last && last.type === 'step' && last.response === null ? items.filter((i) => i !== last) : items;
  return { summary: summarize(db, session), items: cleaned };
}
