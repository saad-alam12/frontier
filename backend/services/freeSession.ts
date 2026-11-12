/**
 * Sessions the learner chooses (design §4.5): the ideas they pick, or the session maker's ideas for
 * what they described; an optional goal; what the ideas build on that the learner does not own; and
 * the start, which writes the session maker's new ideas through the merger and opens a session whose
 * plan is chosen, not planned.
 */
import { z } from 'zod';
import { MAX_FREE_IDEAS, chosenAim, joinNames, missingPremises, teachingOrder } from '../core/freeSession';
import type { PremiseSets } from '../core/freeSession';
import { targetDepthFor } from '../core/leverage';
import { planMerge } from '../core/merge';
import { emptyEdge } from '../core/session';
import type { Depth, Goal, GoalLevel, NodeKind } from '../core/types';
import { logEvent } from '../store/activity';
import type { Database } from '../store/db';
import { transaction } from '../store/db';
import { getGoal, listTargets } from '../store/goals';
import { newId } from '../store/ids';
import { activeSession, appendSessionEvent, createSession, saveSessionState } from '../store/sessions';
import { listChains, listNodes } from '../store/world';
import { mergeIntoMap } from './merger';
import { learnerSpeedNow } from './budget';
import { loadKnowledge, refreshGoalFields } from './knowledge';
import type { MapState } from './map';
import { stepMinutes } from './planner';
import type { LessonStep } from './planner';
import { currentSession } from './session';
import type { FreeSession, NodeStatus, SessionDeps, SessionState } from './sessionState';
import type { SessionSnapshot } from './sessionView';
import type { Proposal, SessionMaker } from './sessionMaker';

export const FreeChoiceSchema = z
  .object({
    goalId: z.string().min(1).nullable(),
    /** Book the session's time to the goal; with no goal it is free study either way. */
    counted: z.boolean(),
    /** Ideas the learner picked, in their order. */
    pick: z.array(z.string().min(1)).min(1).max(MAX_FREE_IDEAS).optional(),
    /** Or the session maker's proposal for what they described. */
    proposalId: z.string().min(1).optional(),
    /** Missing background the learner chose to learn first: ids, or a proposal's new ideas by temp id. */
    addFirst: z.array(z.string().min(1)).max(MAX_FREE_IDEAS).default([]),
    /** "I know this: test me" on picked ideas: each opens at the question that shows its aim. */
    testMe: z.boolean().default(false),
  })
  .refine((c) => (c.pick === undefined) !== (c.proposalId === undefined), { message: 'Pick ideas or describe what you want to learn.' });
export type FreeChoice = z.input<typeof FreeChoiceSchema>;

export interface FreeIdeaView {
  /** An idea's id, or a proposal's temp id for an idea new to the map. */
  ref: string;
  name: string;
  statement: string;
  kind: NodeKind;
  /** New to the map: the session maker wrote it, and it joins the map when the session starts. */
  state: MapState | 'new';
  aim: Depth;
  fromDepth: Depth;
  minutes: number;
  why: string;
  /** Background the learner chose to learn first. */
  addedFirst: boolean;
}

export interface FreeBackgroundView {
  ref: string;
  name: string;
  isNew: boolean;
  /** The session's ideas that build on it; empty when only the session maker named it. */
  neededBy: string[];
  /** The session maker's reason, when it named it. */
  reason: string | null;
}

export interface FreePlanView {
  title: string;
  /** For the learner: what the session covers. */
  summary: string;
  level: GoalLevel;
  ideas: FreeIdeaView[];
  /** What the session's ideas build on that the learner does not own and the session does not teach. */
  background: FreeBackgroundView[];
  minutes: number;
  /** More ideas than a session holds: the learner leaves some for next time. */
  tooMany: boolean;
}

interface Resolved {
  plan: FreePlanView;
  goal: Goal | undefined;
  proposal: Proposal | null;
  /** Each idea's chosen ideas it builds on, by ref. */
  dependsOn: Map<string, string[]>;
}

/** The session a choice would make, changing nothing: for the sheet's warnings and estimate. */
export function previewFree(db: Database, maker: SessionMaker, input: FreeChoice): FreePlanView {
  return resolveChoice(db, maker, FreeChoiceSchema.parse(input)).plan;
}

function resolveChoice(db: Database, maker: SessionMaker, choice: z.output<typeof FreeChoiceSchema>): Resolved {
  const view = loadKnowledge(db);
  const goal = choice.goalId ? getGoal(db, choice.goalId) : undefined;
  if (choice.goalId && !goal) throw new Error('That goal no longer exists.');
  const proposal = choice.proposalId ? maker.proposal(choice.proposalId) : null;
  if (choice.proposalId && !proposal) throw new Error('That plan is no longer here. Plan it again.');
  // a new idea with the same name as one on the map is that idea (as the merger will decide), so it
  // is planned from what the learner already has and never appears twice in the session
  const known = nameIdentities(listNodes(db), proposal?.result.newIdeas ?? []);
  const canon = (ref: string) => known.get(ref) ?? ref;
  const fresh = new Map((proposal?.result.newIdeas ?? []).filter((n) => !known.has(n.tempId)).map((n) => [n.tempId, { ...n, premises: [...new Set(n.premises.map(canon))] }]));
  const asked = new Map((proposal?.result.ideas ?? []).map((s) => [canon(s.ref), { ...s, ref: canon(s.ref) }]));
  const picked = [...new Set((choice.pick ?? [...asked.keys()]).map(canon))];
  const addFirst = choice.addFirst.map(canon);
  for (const ref of [...picked, ...addFirst]) if (!view.nodes.has(ref) && !fresh.has(ref)) throw new Error('An idea you chose is no longer on the map.');

  const session = [...new Set([...addFirst, ...picked])];
  const premiseSets: PremiseSets = (ref) => {
    const n = fresh.get(ref);
    if (n) return n.premises.length ? [n.premises] : [];
    return (view.index.into.get(ref) ?? []).map((c) => c.premises);
  };
  const nameOf = (ref: string) => fresh.get(ref)?.name ?? view.nodes.get(ref)?.name ?? ref;
  const { order, dependsOn } = teachingOrder(session, premiseSets);
  const goalAims = new Map<string, number>();
  if (goal) for (const t of listTargets(db, goal.id)) goalAims.set(t.nodeId, Math.max(goalAims.get(t.nodeId) ?? 0, t.depth));
  const speed = learnerSpeedNow(db);
  const pickedSet = new Set(picked);

  const ideas = order.map((ref): FreeIdeaView => {
    const node = view.nodes.get(ref);
    const n = fresh.get(ref);
    const fromDepth = n ? 0 : (view.states.get(ref)?.depth ?? 0);
    const addedFirst = !pickedSet.has(ref);
    // as deep as the session maker asks, or the chosen goal's plan (any active goal's, with none); else owning it
    const wanted = addedFirst ? 0 : (asked.get(ref)?.aim ?? (goal ? (goalAims.get(ref) ?? 0) : targetDepthFor(ref, view.goals)));
    const aim = chosenAim(wanted, fromDepth);
    const kind = n?.kind ?? node?.kind ?? 'claim';
    const users = session.filter((id) => id !== ref && premiseSets(id).some((set) => set.includes(ref))).map(nameOf);
    const why = addedFirst ? (users.length ? `${joinNames(users)} ${users.length === 1 ? 'builds' : 'build'} on it, so it comes first.` : 'You chose to learn it first.') : (asked.get(ref)?.why ?? 'You chose to learn this now.');
    return {
      ref,
      name: nameOf(ref),
      statement: n?.statement ?? node?.statement ?? '',
      kind,
      state: n ? 'new' : view.owned.has(ref) ? 'owned' : view.fringe.has(ref) ? 'fringe' : 'beyond',
      aim,
      fromDepth: fromDepth as Depth,
      minutes: stepMinutes(kind, fromDepth, aim, speed),
      why,
      addedFirst,
    };
  });

  const reasons = new Map((proposal?.result.background ?? []).map((b) => [canon(b.ref), b.reason]));
  // an overview passes through an idea without rebuilding it, so only ideas taught to be explained need their premises
  const overview = new Set(ideas.filter((i) => i.aim < 2).map((i) => i.ref));
  const background: FreeBackgroundView[] = missingPremises(order, view.owned, premiseSets)
    .map((m) => ({ ...m, neededBy: m.neededBy.filter((ref) => !overview.has(ref)) }))
    .filter((m) => m.neededBy.length > 0 || reasons.has(m.id))
    .map((m) => ({ ref: m.id, name: nameOf(m.id), isNew: fresh.has(m.id), neededBy: m.neededBy.map(nameOf), reason: reasons.get(m.id) ?? null }));
  for (const [ref, reason] of reasons) {
    if (session.includes(ref) || view.owned.has(ref) || background.some((b) => b.ref === ref)) continue;
    background.push({ ref, name: nameOf(ref), isNew: fresh.has(ref), neededBy: [], reason });
  }

  const names = picked.map(nameOf);
  const plan: FreePlanView = {
    title: proposal?.result.title ?? (names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : joinNames(names)),
    summary: proposal?.result.summary ?? `Today covers ${joinNames(names)}, the ${names.length === 1 ? 'idea' : 'ideas'} you chose.`,
    level: proposal?.result.level ?? goal?.level ?? 'working',
    ideas,
    background,
    minutes: ideas.reduce((sum, i) => sum + i.minutes, 0),
    tooMany: ideas.length > MAX_FREE_IDEAS,
  };
  return { plan, goal, proposal, dependsOn };
}

/**
 * Open the chosen session. The session maker's new ideas join the world layer through the merger, as
 * unverified ideas taught from the model's knowledge and cited to this session; then the session runs
 * the normal step loop on its ideas. No recall from last time and no practice at the end: it is about
 * what the learner asked. Runs as the session's work, like planning one.
 */
export async function startFreeSession(deps: SessionDeps, maker: SessionMaker, input: FreeChoice): Promise<SessionSnapshot> {
  const { db } = deps;
  const choice = FreeChoiceSchema.parse(input);
  if (activeSession(db)) throw new Error('A session is open. Finish or end it first.');
  await deps.work.run({ kind: 'start', sessionId: null, goalId: choice.goalId, sent: null, stoppable: false }, async () => openFreeSession(db, maker, choice), (id) => id);
  if (choice.proposalId) maker.forget(choice.proposalId);
  return currentSession(db, deps.work) as SessionSnapshot;
}

function openFreeSession(db: Database, maker: SessionMaker, choice: z.output<typeof FreeChoiceSchema>): string {
  const { plan, goal, proposal, dependsOn } = resolveChoice(db, maker, choice);
  if (plan.tooMany) throw new Error(`A session holds up to ${MAX_FREE_IDEAS} ideas. Leave some for next time.`);
  const counted = goal !== undefined && choice.counted;
  const sessionId = transaction(db, () => {
    const session = createSession<SessionState | null>(db, counted ? goal.id : null, null);
    const ids = proposal ? mergeProposal(db, session.id, proposal) : new Map<string, string>();
    const idOf = (ref: string) => ids.get(ref) ?? ref;
    const steps: LessonStep[] = plan.ideas.map((i) => ({
      nodeId: idOf(i.ref),
      name: i.name,
      kind: i.kind,
      why: i.why,
      aim: i.aim,
      fromDepth: i.fromDepth,
      minutes: i.minutes,
      simplified: null,
      dependsOn: (dependsOn.get(i.ref) ?? []).map(idOf),
    }));
    const free: FreeSession = { description: proposal?.description ?? null, picked: proposal ? [] : plan.ideas.filter((i) => !i.addedFirst).map((i) => i.name), counted, level: plan.level };
    const state: SessionState = {
      goalId: goal?.id ?? null,
      plan: { goalId: goal?.id ?? null, title: plan.title, orientation: plan.summary, steps, candidateCount: steps.length, unreachableTargets: [] },
      phase: 'orient',
      stepIndex: 0,
      stage: null,
      supportAfter: null,
      card: null,
      edge: emptyEdge(),
      nodeStatus: Object.fromEntries(steps.map((s) => [s.nodeId, 'pending' as NodeStatus])),
      history: {},
      transcript: [],
      previousNodes: [],
      closing: null,
      pendingEffort: null,
      resume: null,
      priorMinutes: {},
      free,
      testMe: choice.testMe || undefined,
    };
    saveSessionState(db, session.id, state);
    logEvent(db, 'session.started', { goalId: counted ? goal.id : null, sessionId: session.id }, { steps: steps.length, free: true });
    appendSessionEvent(db, session.id, 'start', { goalId: state.goalId, plan: { title: plan.title, steps: steps.map((s) => s.nodeId) }, resumes: null, free: { description: free.description, picked: free.picked } });
    return session.id;
  });
  // new ideas move the fringe and the tiers
  if (proposal?.result.newIdeas.length) refreshGoalFields(db);
  return sessionId;
}

/**
 * The merger writes the proposal's new ideas and the chains from their premises, cited to the session.
 * A new idea with the same name as one on the map is that idea. Returns temp id → node id.
 */
function mergeProposal(db: Database, sessionId: string, proposal: Proposal): Map<string, string> {
  const nodes = listNodes(db);
  const existingNodes = new Map(nodes.map((n) => [n.id, n]));
  const identities = nameIdentities(nodes, proposal.result.newIdeas);
  const plan = planMerge({
    sourceId: sessionId,
    extractedNodes: proposal.result.newIdeas.map((n) => ({ tempId: n.tempId, kind: n.kind, name: n.name, statement: n.statement, aliases: [] })),
    extractedChains: proposal.result.newIdeas.filter((n) => n.premises.length > 0).map((n) => ({ premises: n.premises, conclusion: n.tempId })),
    identities,
    existingNodes,
    existingChains: listChains(db),
    newId: (prefix) => newId(prefix),
    newStatus: 'unverified',
  });
  mergeIntoMap(db, plan);
  return plan.resolved;
}

/** New ideas whose name (or an alias) matches an idea on the map: temp id → node id. */
function nameIdentities(nodes: { id: string; name: string; aliases: string[] }[], newIdeas: { tempId: string; name: string }[]): Map<string, string> {
  const byName = new Map(nodes.flatMap((n) => [n.name, ...n.aliases].map((name) => [nameKey(name), n.id] as const)));
  const identities = new Map<string, string>();
  for (const n of newIdeas) {
    const same = byName.get(nameKey(n.name));
    if (same) identities.set(n.tempId, same);
  }
  return identities;
}

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[$\\{}]/g, '').replace(/\s+/g, ' ').trim();
}
