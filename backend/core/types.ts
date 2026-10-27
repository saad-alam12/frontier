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

export interface Goal {
  id: string;
  text: string;
  /** Higher means more important; 1 is the default. */
  priority: number;
  status: 'active' | 'paused' | 'done';
  createdAt: string;
  compiledAt: string | null;
}

export interface Capability {
  id: string;
  goalId: string;
  statement: string;
  order: number;
  masteredAt: string | null;
}

export interface Target {
  capabilityId: string;
  nodeId: string;
  depth: Depth;
}

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
}

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
