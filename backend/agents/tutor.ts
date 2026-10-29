import { z } from 'zod';
import { isGraded } from '../core/session';
import type { Stage } from '../core/session';
import type { LlmProvider } from '../llm/provider';
import { confidenceLabel } from '../core/types';
import type { Assessment, GoalFocus, GoalLevel } from '../core/types';
import { answerReadingPrompt } from './prompts';

const md = (max: number) => z.string().trim().min(1).max(max);
const Rubric = z.array(z.string().trim().min(2).max(300)).min(1).max(6);

export const CardSchemas = {
  predict: z.object({ stage: z.literal('predict'), prompt: md(1500) }),
  explain: z.object({ stage: z.literal('explain'), markdown: md(6000) }),
  check: z.object({ stage: z.literal('check'), question: md(1500), answerKey: md(2000), rubric: Rubric }),
  derive: z.object({ stage: z.literal('derive'), prompt: md(1500), answerKey: md(3000), rubric: Rubric }),
  connect: z.object({ stage: z.literal('connect'), prompt: md(1500) }),
  compress: z.object({ stage: z.literal('compress'), prompt: md(1000) }),
  use: z.object({ stage: z.literal('use'), task: md(2500), answerKey: md(3000), rubric: Rubric }),
  index: z.object({ stage: z.literal('index'), gist: md(2000), placement: md(600), question: md(800), answerKey: md(1000) }),
  support: z.object({ stage: z.literal('support'), markdown: md(6000) }),
  reteach: z.object({ stage: z.literal('reteach'), markdown: md(6000) }),
} as const;

export type TutorCard = z.infer<(typeof CardSchemas)[keyof typeof CardSchemas]>;

export const GradeSchema = z.object({
  score: z.number().min(0).max(1),
  feedback: md(3000),
  misconception: z.string().trim().max(300).nullable().default(null),
  confidentlyWrong: z.boolean().default(false),
  /** A prerequisite the learner plainly lacks (not a slip): what it is and roughly how long to learn it from scratch. */
  missingBackground: z
    .object({ name: z.string().trim().min(2).max(120), hours: z.number().min(0.25).max(200) })
    .nullable()
    .default(null),
});
export type Grade = z.infer<typeof GradeSchema>;

export function buildStepSchema(nextStage: Stage | null, expectGrade: boolean) {
  const card = nextStage ? CardSchemas[nextStage] : z.null();
  const grade = expectGrade ? GradeSchema : z.null();
  return z.object({ grade, card });
}

/** One answer field (answer and reasoning mixed, or empty for "no idea"), optional confidence, and extras some cards ask for. */
export interface LearnerResponse {
  answer: string;
  /** One of CONFIDENCE_LEVELS' values; absent when not given. */
  confidence?: number;
  /** 1–5 rating after an explanation. */
  effort?: number;
  /** Optional handle on the compress card. */
  handle?: string;
  /** "I know this, test me" on a predict or explain card: go straight to the question that shows the aim. */
  testMe?: boolean;
}

export interface TutorGoal {
  text: string;
  /** How deep the goal's language goes; null for goals compiled before levels existed. */
  level: GoalLevel | null;
  /** What the goal means in the learner's time. */
  scope: string | null;
  assessment: Assessment;
  focus: GoalFocus[];
}

export interface TutorStepInput {
  goal: TutorGoal;
  why: string;
  node: { id: string; kind: string; name: string; statement: string };
  /** The depth this session takes the idea to; the loop stops there. */
  aim: number;
  /** Why the idea was simplified for this learner (teach its core intuition); null when it was not. */
  simplified: string | null;
  premises: { name: string; statement: string; owned: boolean; ownStatement: string | null; handle: string | null; simplified: boolean }[];
  dependents: { name: string }[];
  bugs: string[];
  /** Worked examples from the sources for this node: material for worked-example cards and use tasks. */
  examples: { title: string; locator: string; body: string }[];
  excerpts: { locator: string; text: string }[];
  /** Earlier cards and responses for this node, oldest first. */
  history: { stage: Stage; card: TutorCard; response: LearnerResponse | null; grade: Grade | null }[];
  previous: { stage: Stage; card: TutorCard; response: LearnerResponse } | null;
  nextStage: Stage | null;
}

export interface TutorStepResult {
  grade: Grade | null;
  card: TutorCard | null;
}

export async function runTutorStep(provider: LlmProvider, input: TutorStepInput): Promise<TutorStepResult> {
  const expectGrade = input.previous !== null && isGraded(input.previous.stage);
  const sections: string[] = [];
  sections.push(goalSection(input.goal, input.why));
  sections.push(`## Node (for you only; do not reveal it before the learner has tried)\n[${input.node.id}] ${input.node.name} (${input.node.kind})\n${input.node.statement}`);
  sections.push(`## How deep this idea goes today\nThe plan asks depth ${input.aim}: ${DEPTH_TEXT[Math.max(1, Math.min(5, input.aim))]}. Teach to that and no further, and keep the whole idea within about half an hour.`);
  if (input.simplified) {
    sections.push(
      `## Simplified for this learner\n${input.simplified}. Teach the idea's core intuition in plain words with an everyday picture: what it does, why it matters, what the rest of the map needs from it. No formulas, symbols or derivations; leave the detail for later.`,
    );
  }
  sections.push(
    `## Premises and the learner's hold on them\n${
      input.premises.length
        ? input.premises
            .map(
              (p) =>
                `- ${p.name}${p.owned ? ' (owned)' : ' (not yet owned)'}${p.simplified ? ' (learned as an intuition only)' : ''}: ${p.statement}${p.ownStatement ? `\n  learner's own words: "${p.ownStatement}"` : ''}${p.handle ? `\n  handle: "${p.handle}"` : ''}`,
            )
            .join('\n')
        : '(no premises recorded)'
    }`,
  );
  if (input.dependents.length) sections.push(`## What builds on this node later\n${input.dependents.map((d) => `- ${d.name}`).join('\n')}`);
  if (input.bugs.length) sections.push(`## Open misconceptions for this node\n${input.bugs.map((b) => `- ${b}`).join('\n')}`);
  if (input.examples.length) sections.push(`## Worked examples from the sources\n${input.examples.map((e) => `### ${e.title} (${e.locator})\n${e.body}`).join('\n\n')}`);
  if (input.excerpts.length) sections.push(`## Source excerpts\n${input.excerpts.map((e) => `### ${e.locator}\n${e.text}`).join('\n\n')}`);
  if (input.history.length) {
    sections.push(
      `## Earlier in this node\n${input.history
        .map((h) => `### ${h.stage}\nCard: ${cardText(h.card)}${h.response ? `\nLearner: ${responseText(h.response)}` : ''}${h.grade ? `\nGrade: ${h.grade.score.toFixed(2)} — ${h.grade.feedback}` : ''}`)
        .join('\n\n')}`,
    );
  }
  if (input.previous) {
    sections.push(`## Previous card (${input.previous.stage})\n${cardText(input.previous.card)}\n\n## Learner's response\n${responseText(input.previous.response)}`);
  }
  sections.push(
    input.nextStage
      ? `## Task\n${expectGrade ? 'Grade the response, then produce' : 'Produce'} the **${input.nextStage}** card.`
      : '## Task\nGrade the response. No card is needed; this node is finished.',
  );
  if (input.nextStage === 'reteach') {
    sections.push(
      'The learner has failed this idea again after a worked example. Read everything above about this idea, work out the one misunderstanding that best explains all of their answers, and write a fresh explanation that starts from it.',
    );
  }
  const result = await provider.complete({
    // the fresh explanation after a worked example goes to the escalation model
    role: input.nextStage === 'reteach' ? 'tutorEscalation' : 'tutor',
    system: answerReadingPrompt('tutor'),
    messages: [{ role: 'user', content: sections.join('\n\n') }],
    submit: { name: 'submit_step', description: 'Submit the grade for the previous response (or null) and the next card (or null).', schema: buildStepSchema(input.nextStage, expectGrade) },
  });
  return result.data as TutorStepResult;
}

const DEPTH_TEXT = [
  '',
  'recognize: know it exists and roughly what it is about',
  'explain: state it in their own words with an example',
  'derive: rebuild it from its premises and say why each is needed',
  'apply: use it correctly inside a task',
  'transfer: use it in a far context, critique it, teach it',
];

const LEVEL_TEXT: Record<GoalLevel, string> = {
  intuition: 'intuition: plain words, pictures and analogies, no formulas',
  working: 'working knowledge: the key notation and formulas, explained in words and used on small examples',
  rigorous: 'rigorous: precise definitions, derivations and proofs',
};

const ASSESSMENT_TEXT: Record<Assessment, string> = {
  written_exam: 'a written exam',
  oral_exam: 'an oral exam',
  presentation_or_project: 'a presentation or project',
  outcome: 'a concrete outcome',
  none: 'nothing; the learner studies for themselves',
};

const FOCUS_TEXT: Record<GoalFocus, string> = { concepts: 'conceptual understanding', math: 'mathematical rigour', practice: 'practical application' };

function goalSection(goal: TutorGoal, why: string): string {
  const lines = [`## Goal\n${goal.text}`];
  if (goal.scope) lines.push(`What it means in the learner's time: ${goal.scope}`);
  if (goal.level) lines.push(`Level: ${LEVEL_TEXT[goal.level]}.`);
  lines.push(`Assessed by ${ASSESSMENT_TEXT[goal.assessment]}.${goal.focus.length ? ` The learner wants ${goal.focus.map((f) => FOCUS_TEXT[f]).join(' and ')}.` : ''}`);
  lines.push(`Why this node today: ${why}`);
  return lines.join('\n\n');
}

export function cardText(card: TutorCard): string {
  switch (card.stage) {
    case 'predict':
    case 'connect':
    case 'compress':
      return card.prompt;
    case 'explain':
    case 'support':
    case 'reteach':
      return card.markdown;
    case 'check':
      return `${card.question}\n(answer key: ${card.answerKey}; rubric: ${card.rubric.join(' / ')})`;
    case 'derive':
      return `${card.prompt}\n(answer key: ${card.answerKey}; rubric: ${card.rubric.join(' / ')})`;
    case 'use':
      return `${card.task}\n(answer key: ${card.answerKey}; rubric: ${card.rubric.join(' / ')})`;
    case 'index':
      return `${card.gist}\n${card.placement}\nQuestion: ${card.question} (answer key: ${card.answerKey})`;
  }
}

export function responseText(r: LearnerResponse): string {
  const parts = [r.answer.trim() ? r.answer : '(empty: the learner has no idea)'];
  if (r.confidence !== undefined) parts.push(`confidence: ${confidenceLabel(r.confidence)}`);
  if (r.handle) parts.push(`handle: ${r.handle}`);
  if (r.effort !== undefined) parts.push(`effort ${r.effort}/5`);
  if (r.testMe) parts.push('(the learner said they know this and asked to be tested)');
  return parts.join('\n');
}

/** Free recall at session start (previous session's nodes) and at close (today's nodes). */
export const RecallSchema = z.object({
  recalled: z.array(z.object({ nodeId: z.string().min(1), score: z.number().min(0).max(1), note: z.string().trim().max(300).default('') })).min(1),
  canDo: z.string().trim().max(400).nullable().default(null),
  previewQuestion: z.string().trim().max(800).nullable().default(null),
});
export type RecallResult = z.infer<typeof RecallSchema>;

export async function runRecall(
  provider: LlmProvider,
  input: { goalText: string; nodes: { id: string; name: string; statement: string }[]; text: string; closing: boolean },
): Promise<RecallResult> {
  const ids = new Set(input.nodes.map((n) => n.id));
  const schema = RecallSchema.superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.recalled.forEach((r, i) => {
      if (!ids.has(r.nodeId)) ctx.addIssue({ code: 'custom', path: ['recalled', i, 'nodeId'], message: `unknown nodeId ${r.nodeId}` });
      seen.add(r.nodeId);
    });
    for (const id of ids) if (!seen.has(id)) ctx.addIssue({ code: 'custom', path: ['recalled'], message: `missing a score for ${id}` });
    if (input.closing && !value.canDo) ctx.addIssue({ code: 'custom', path: ['canDo'], message: 'canDo is required for the closing summary' });
    if (input.closing && !value.previewQuestion) ctx.addIssue({ code: 'custom', path: ['previewQuestion'], message: 'previewQuestion is required for the closing summary' });
  });
  const message = [
    `Goal: ${input.goalText}`,
    `## Ideas covered\n${input.nodes.map((n) => `- [${n.id}] ${n.name}: ${n.statement}`).join('\n')}`,
    `## Learner's recall\n${input.text || '(nothing written)'}`,
    input.closing ? 'Score every idea and add the closing summary (canDo and previewQuestion).' : 'Score every idea. No closing summary.',
  ].join('\n\n');
  const result = await provider.complete({
    role: 'tutor',
    system: answerReadingPrompt('recall'),
    messages: [{ role: 'user', content: message }],
    submit: { name: 'submit_recall', description: 'Submit recall scores per idea and, when asked, the closing summary.', schema },
  });
  return result.data;
}
