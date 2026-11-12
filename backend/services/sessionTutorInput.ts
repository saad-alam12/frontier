/**
 * What the tutor is given for a card: the goal as it reads it, the idea's neighbourhood, sources,
 * figures and their pictures, and the pictures of the answer being judged.
 */
import { passageFor } from '../core/passage';
import type { LearnerResponse, TutorFigure, TutorGoal, TutorStepInput } from '../agents/tutor';
import { joinNames } from '../core/freeSession';
import { dependents } from '../core/graph';
import { isGraded } from '../core/session';
import type { Stage } from '../core/session';
import type { Goal } from '../core/types';
import type { LlmImage } from '../llm/provider';
import { readAttachment } from '../store/attachments';
import { figuresForNode, getFigure } from '../store/figures';
import type { Database } from '../store/db';
import { listBugsForNode } from '../store/bugs';
import { getState } from '../store/evidence';
import { getGoal, listTargets } from '../store/goals';
import { chunksCoveringNode, getSource } from '../store/sources';
import { listExamplesForNode } from '../store/world';
import { cardsToJudge } from './cards';
import { loadKnowledge } from './knowledge';
import type { LessonStep } from './planner';
import type { SessionState, SessionDeps } from './sessionState';

/** Figures whose pictures go with a call that writes an explaining card: the first two the idea has. */
const FIGURE_PICTURES = 2;

export function figureImagesOf(deps: SessionDeps, figures: TutorFigure[]): LlmImage[] | undefined {
  const dir = deps.figuresDir;
  if (!dir || figures.length === 0) return undefined;
  const images: LlmImage[] = [];
  for (const figure of figures.slice(0, FIGURE_PICTURES)) {
    const stored = getFigure(deps.db, figure.id);
    if (!stored?.file) break;
    try {
      images.push(readAttachment(dir, stored.file));
    } catch {
      // a picture file that went missing: the tutor goes by the description, and the order still matches
      break;
    }
  }
  return images.length ? images : undefined;
}

/** The images of the response being judged (attached, then the plots its code drew), read from disk for the model call. */
export function imagesOf(deps: SessionDeps, response: LearnerResponse): LlmImage[] | undefined {
  const dir = deps.attachmentsDir;
  const names = [...(response.attachments ?? []), ...(response.code?.run?.plots ?? [])];
  if (!names.length || !dir) return undefined;
  return names.map((name) => readAttachment(dir, name));
}

/** What the tutor needs to know about the goal: its sentence and how the time reads it. */
function tutorGoal(goal: Goal | undefined): TutorGoal {
  return { text: goal?.text ?? '', level: goal?.level ?? null, scope: goal?.scope ?? null, assessment: goal?.assessment ?? 'none', focus: goal?.focus ?? [], context: goal?.context ?? null };
}

/**
 * The goal frame for a session. A chosen one adds what the learner asked to its goal's frame, at the
 * session's level; with no goal, what was asked is the goal, studied for its own sake.
 */
export function tutorGoalFor(db: Database, state: SessionState): TutorGoal {
  const goal = state.goalId ? getGoal(db, state.goalId) : undefined;
  const free = state.free;
  if (!free) return tutorGoal(goal);
  const asked = free.description ? `The learner asked for this session: "${free.description}"` : `The learner chose to learn ${joinNames(free.picked)} now.`;
  if (goal) return { ...tutorGoal(goal), text: `${goal.text}\n\n${asked}`, level: free.level };
  return { text: asked, level: free.level, scope: null, assessment: 'none', focus: [], context: null };
}

/** Figures the tutor is told about for one idea. */
const MAX_FIGURES = 4;

export function buildTutorInput(db: Database, state: SessionState, step: LessonStep, previous: TutorStepInput['previous'], nextStage: Stage | null, goal: TutorGoal): TutorStepInput {
  const view = loadKnowledge(db);
  const node = view.nodes.get(step.nodeId);
  if (!node) throw new Error(`unknown node ${step.nodeId}`);
  const simplified = new Set(state.goalId ? listTargets(db, state.goalId, { all: true }).filter((t) => t.simplified).map((t) => t.nodeId) : []);
  const premiseIds = new Set<string>();
  for (const chain of view.index.into.get(node.id) ?? []) for (const p of chain.premises) premiseIds.add(p);
  const premises = [...premiseIds].map((id) => {
    const p = view.nodes.get(id);
    const s = getState(db, id);
    return { name: p?.name ?? id, statement: p?.statement ?? '', owned: view.owned.has(id), ownStatement: s?.ownStatement ?? null, handle: s?.handle ?? null, simplified: simplified.has(id) };
  });
  const deps = [...dependents(node.id, view.index, 1, 1).keys()].map((id) => ({ name: view.nodes.get(id)?.name ?? id }));
  return {
    goal,
    why: step.why,
    node: { id: node.id, kind: node.kind, name: node.name, statement: node.statement },
    aim: step.aim,
    simplified: step.simplified,
    premises,
    dependents: deps,
    bugs: listBugsForNode(db, node.id).map((b) => b.description),
    examples: listExamplesForNode(db, node.id).map((e) => ({ title: e.title, locator: `${getSource(db, e.sourceId)?.title ?? 'source'}, ${e.locator}`, body: e.body })),
    // the page that teaches the idea (its citation), not the first page of the source it is in
    excerpts: chunksCoveringNode(db, node.id).map((c) => {
      const cited = node.sources.find((ref) => ref.sourceId === c.sourceId)?.locator;
      return { locator: `${c.sourceTitle}, ${cited ?? c.locator}`, text: passageFor(c.text, cited, node.name) };
    }),
    figures: figuresForNode(db, node.id)
      .slice(0, MAX_FIGURES)
      .map((f) => ({ id: f.id, where: `${f.sourceTitle}, ${f.locator}`, shows: f.caption ?? 'A figure from the material.' })),
    history: (state.history[node.id] ?? []).filter((h) => h.response !== null || h.grade !== null),
    previous,
    cards: previous && isGraded(previous.stage) ? cardsToJudge(db, [node.id, ...premiseIds]) : [],
    nextStage,
  };
}
