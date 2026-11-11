/**
 * Domain types shared by core, store, agents and (as types only) the UI.
 * Dates are ISO strings so they survive SQLite and IPC unchanged.
 */

export type NodeKind = 'claim' | 'procedure' | 'term';

/** A citation: a source plus a page, slide, timestamp, heading or session id. */
export interface SourceRef {
  sourceId: string;
  locator?: string;
}

export interface KnowledgeNode {
  id: string;
  kind: NodeKind;
  name: string;
  statement: string;
  aliases: string[];
  sources: SourceRef[];
  /** `unverified` nodes were created by a goal compile and still need grounding in a source. */
  status: 'verified' | 'unverified';
}

/** The premises jointly entail (or are required for) the conclusion. */
export interface Chain {
  id: string;
  premises: string[];
  conclusion: string;
  sources: SourceRef[];
}

/** A worked example from a source, attached to the idea it illustrates. */
export interface WorkedExample {
  id: string;
  nodeId: string;
  sourceId: string;
  locator: string;
  title: string;
  /** Markdown with LaTeX: the problem and its worked solution. */
  body: string;
}

export type EvidenceKind = 'predict' | 'check' | 'explain' | 'derive' | 'use' | 'practice' | 'recall' | 'lookup';

export interface EvidenceContext {
  /** Practice rung 0–4 (design §5.1). */
  rung?: number;
  /** Cue distance 0–2. */
  cue?: number;
  /** Set when this evidence is implicit credit propagated from a use of a dependent node. */
  implicit?: { fromNodeId: string; fromEvidenceId: string; hops: number; weight: number };
  /** Free-form label: which step or problem produced it. */
  step?: string;
  problemId?: string;
}

export interface Evidence {
  id: string;
  nodeId: string;
  at: string;
  kind: EvidenceKind;
  /** Score 0–1. Grades 0–10 are normalized before they get here. */
  score: number;
  reasoning: string;
  /** Learner-rated effort 1–5, when asked. */
  effort: number | null;
  /** Learner's confidence 0–1 on predictions and answers. */
  confidence: number | null;
  context: EvidenceContext;
  sessionId: string | null;
}

export type Tier = 'internalize' | 'index' | 'archive';

export interface FsrsState {
  stability: number;
  difficulty: number;
  lastReview: string | null;
  due: string | null;
  reps: number;
  lapses: number;
}

export type Depth = 0 | 1 | 2 | 3 | 4 | 5;

export interface NodeState {
  nodeId: string;
  depth: Depth;
  targetDepth: Depth;
  tier: Tier;
  /** The learner's own wording. Never overwritten by the system. */
  ownStatement: string | null;
  handle: string | null;
  fsrs: FsrsState;
  firstSessionId: string | null;
}

export interface Bug {
  id: string;
  nodeId: string;
  description: string;
  firstSeen: string;
  lastSeen: string;
  resolvedAt: string | null;
}

export type GoalKind = 'course' | 'personal';
export type Assessment = 'written_exam' | 'oral_exam' | 'presentation_or_project' | 'outcome' | 'none';
/** What a goal's material is for (design §3.1). */
export type MaterialRole = 'teaching' | 'practice' | 'assessment' | 'scope' | 'reference';
export const MATERIAL_ROLES: readonly MaterialRole[] = ['teaching', 'practice', 'assessment', 'scope', 'reference'];
/** Roles whose sources are read into ideas; the others are kept as text for style, scope and practice. */
export const EXTRACTED_ROLES: readonly MaterialRole[] = ['teaching', 'reference'];

/** Summary of past exams: what the assessment looks like. */
export interface ExamProfile {
  /** One or two sentences, addressed to the learner. */
  summary: string;
  format: string;
  durationMinutes: number | null;
  aids: string;
  questionTypes: string[];
  difficulty: string;
}

/** A lecture or unit the scope document says is still to come. */
export interface UpcomingUnit {
  title: string;
  /** Free text from the scope document ("3 November", "week 7"), or null. */
  expected: string | null;
}

export interface Goal {
  id: string;
  /** The learner's sentence. */
  text: string;
  /** A short name ("Deep Learning in Physics"), set by the compiler; null until then. */
  title: string | null;
  kind: GoalKind;
  assessment: Assessment;
  /** Free text, e.g. "1.0" on the German scale. */
  targetGrade: string | null;
  /** Exam or deadline, ISO date (YYYY-MM-DD). */
  date: string | null;
  /** The time the learner gives the goal, as they entered it; null when not set or when there is no time limit. */
  budget: GoalBudget | null;
  /**
   * Set for a goal with no time limit: how deep the learner wants it, which the compiler reads with the
   * goal and its context. Null for a goal fitted to a time (and for goals from before R2 with no budget).
   */
  wantedLevel: GoalLevel | null;
  /** What kind of understanding the learner wants; empty means a balanced mix. */
  focus: GoalFocus[];
  /** Whether the goal's first material covers the whole goal, judged at compile; null before. */
  coverage: Coverage | null;
  /** Depth of each targeted idea when the goal started (or when the idea joined it), for pace. */
  baseline: Record<string, Depth>;
  /** Higher means more important; 1 is the default. */
  priority: number;
  /** A draft is being set up and previewed; it becomes active when the learner approves its plan. */
  status: 'draft' | 'active' | 'paused' | 'done';
  /** When the goal's current rhythm began: its approval, a new time, or being taken up again. Null for a draft. */
  rhythmAt: string | null;
  createdAt: string;
  approvedAt: string | null;
  compiledAt: string | null;
  /** Teaching and reference sources the last compile covered (incremental compile adds the rest). */
  compiledSources: string[];
  examProfile: ExamProfile | null;
  coursePlan: UpcomingUnit[];
  /** Assessment and scope sources the profile was built from. */
  profileSources: string[];
  /** Unverified nodes the learner chose to learn anyway. */
  startedUnverified: string[];
  /** How the compiler reads the goal for its time, purpose and the learner's background; null before R3 compiles. */
  level: GoalLevel | null;
  /** One or two plain sentences: what the goal means in the time given. */
  scope: string | null;
  /** What the learner says they already know about it, in their words. */
  background: string | null;
  /** Anything that shapes the goal, in the learner's words: reasons, purpose, constraints, what to focus on or skip. */
  context: string | null;
  /** Prerequisites the learner showed they lack, from the probe and sessions. */
  gaps: BackgroundGap[];
  /** A re-map waiting to be made or approved; null when there is none. */
  remap: GoalRemap | null;
  /** Something the learner asked to add, being worked out or waiting for a yes; null when there is none. */
  addition: GoalAddition | null;
  /** Minutes added by going deeper on simplified ideas, on top of the time as the learner gave it. */
  extraMinutes: number;
}

/** A prerequisite the learner showed they lack (design §3.2), as the tutor or the prober named it. */
export interface BackgroundGap {
  name: string;
  /** Rough hours to learn it from scratch: the model's estimate. */
  hours: number;
  source: 'probe' | 'session';
  /** `new` until a re-map has been proposed for it (approved or not). */
  status: 'new' | 'proposed';
  at: string;
}

/** A new map for the goal, proposed for the learner to approve; never applied on its own. */
export interface RemapProposal {
  /** Why, in a sentence for the learner. */
  reason: string;
  title: string;
  level: GoalLevel;
  scope: string;
  capabilities: { statement: string; targets: { ref: string; depth: number; core: boolean }[] }[];
  newNodes: { tempId: string; kind: NodeKind; name: string; statement: string }[];
  /** A separate goal for a missing foundation the time cannot cover. */
  backgroundGoal: { text: string; hours: number } | null;
  /**
   * The sources the goal had compiled when this map was drawn. Material that arrives while the
   * proposal waits is compiled into the old map; approving replaces that map, so only these sources
   * count as compiled afterwards and the newer material is compiled again, onto the new map.
   * Absent on proposals stored before this was recorded.
   */
  sources?: string[];
}

/** What the learner changed that asks for a new map: the context, or how deep they want to go (or a time instead). */
export type RemapCause = 'context' | 'level';

/**
 * A re-map waiting to be drawn (`requested`) or approved (`ready`). `causes` says what the learner
 * changed when the request came from an edit; without it the learner asked, or their answers showed gaps.
 */
export type GoalRemap = { state: 'requested'; at: string; causes?: RemapCause[] } | { state: 'ready'; at: string; proposal: RemapProposal };

/** The longest context a goal keeps, in characters. */
export const CONTEXT_MAX_CHARS = 4000;

/**
 * What the compiler would add to a goal for the learner's request (design §3.2, additions); nothing
 * changes until the learner says yes.
 */
export interface AdditionProposal {
  /** Whether the request belongs to this goal; when it does not, `reason` says why in one sentence. */
  fits: boolean;
  reason: string | null;
  /** Read from the wording: how the goal relates to a field (several broad ideas) or one aspect (fewer, deeper). */
  shape: 'broad' | 'deep';
  capabilities: { statement: string; targets: { ref: string; depth: number; core: boolean }[] }[];
  newNodes: { tempId: string; kind: NodeKind; name: string; statement: string }[];
}

/** An addition the learner asked for: being worked out in the background, ready to preview, or failed. */
export type GoalAddition =
  | { state: 'requested'; request: string; at: string }
  | { state: 'ready'; request: string; at: string; proposal: AdditionProposal }
  | { state: 'failed'; request: string; at: string; message: string };

/** How long a request to add to a goal may be, in characters: a sentence or two. */
export const ADDITION_MAX_CHARS = 500;

/**
 * How deep the goal's language goes (design §3.1): intuition (plain words and pictures, no formulas),
 * working (the key notation and formulas, explained and used), rigorous (precise definitions,
 * derivations, proofs).
 */
export const GOAL_LEVELS = ['intuition', 'working', 'rigorous'] as const;
export type GoalLevel = (typeof GOAL_LEVELS)[number];

export interface GoalMaterial {
  sourceId: string;
  role: MaterialRole;
  addedAt: string;
}

export interface Capability {
  id: string;
  goalId: string;
  statement: string;
  order: number;
  masteredAt: string | null;
  /** The learner's words when the capability came from adding to the goal; null otherwise. */
  request: string | null;
}

export interface Target {
  capabilityId: string;
  nodeId: string;
  /** The depth the plan holds for it: the ideal depth trimmed to the time budget. */
  depth: Depth;
  /** The depth the compiler asked for. */
  idealDepth: Depth;
  /** The compiler marked it core: the goal fails without it. */
  core: boolean;
  /** The depth of the plan the learner approved; automatic re-plans never go deeper. Null: not capped. */
  approvedDepth: Depth | null;
  /** Why the idea was simplified for this goal (taught as its core intuition); null when it was not. */
  simplified: string | null;
}

/**
 * Time for a goal as the learner gives it (design §3.4). It always resolves to a true total:
 * a total; a rate for a length ("10 h a week for 6 months"); or hours per teaching resource
 * ("2 h per lecture"), which grows as lectures arrive.
 */
export type GoalBudget =
  | { mode: 'total'; hours: number }
  | { mode: 'rate'; hours: number; per: 'day' | 'week'; length: number; lengthUnit: 'days' | 'weeks' | 'months' }
  | { mode: 'resource'; hours: number };

export const GOAL_FOCUS = ['concepts', 'math', 'practice'] as const;
/** Conceptual understanding, mathematical rigour, practical application (code, real tasks). */
export type GoalFocus = (typeof GOAL_FOCUS)[number];

/** Does the goal's material cover the whole goal, part of it, or only a fragment (design §3.2)? */
export type Coverage = 'complete' | 'partial' | 'fragment';

export type SourceKind = 'pdf' | 'markdown' | 'text' | 'html' | 'session';

export interface Source {
  id: string;
  kind: SourceKind;
  title: string;
  /** Path inside the data folder's sources directory, or null for session transcripts. */
  path: string | null;
  /** Content hash; re-adding the same content is a no-op. */
  hash: string;
  addedAt: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  chunkCount: number;
  chunksDone: number;
  error: string | null;
  /** Which extraction read it; below `EXTRACTION` it was read into many small ideas and can be read again. */
  extraction: number;
}

/** The current extraction: whole documents into lesson-sized ideas (1 was small chunks into small ideas). */
export const EXTRACTION = 2;

/** The three confidence choices next to every answer (optional; none means not given). */
export const CONFIDENCE_LEVELS = [
  { label: 'A guess', value: 0.33 },
  { label: 'Fairly sure', value: 0.66 },
  { label: 'Sure', value: 0.9 },
] as const;

/** How a stored confidence reads to a model and in history: the nearest of the three choices. */
export function confidenceLabel(value: number): string {
  let best: (typeof CONFIDENCE_LEVELS)[number] = CONFIDENCE_LEVELS[0];
  for (const level of CONFIDENCE_LEVELS) if (Math.abs(level.value - value) < Math.abs(best.value - value)) best = level;
  return best.label.toLowerCase();
}

export const PASS_SCORE = 0.7;
export const OWNED_RECALL = 0.8;
export const OWNED_DEPTH: Depth = 2;

export function clampDepth(n: number): Depth {
  const d = Math.max(0, Math.min(5, Math.round(n)));
  return d as Depth;
}
