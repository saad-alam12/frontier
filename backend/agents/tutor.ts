import { z } from 'zod';
import { isGraded } from '../core/session';
import type { Stage } from '../core/session';
import type { LlmImage, LlmProvider } from '../llm/provider';
import { confidenceLabel } from '../core/types';
import type { Assessment, GoalFocus, GoalLevel } from '../core/types';
import { answerReadingPrompt, loadPrompt } from './prompts';

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
  /** Flashcards whose fact the response states correctly and unaided; code counts each as a "Good" review. */
  recalledCards: z.array(z.string().min(1)).max(12).default([]),
});
export type Grade = z.infer<typeof GradeSchema>;

/** The grade may name only the flashcards it was shown. */
function gradeFor(cardIds: ReadonlySet<string>) {
  return GradeSchema.superRefine((grade, ctx) => {
    grade.recalledCards.forEach((id, i) => {
      if (!cardIds.has(id)) ctx.addIssue({ code: 'custom', path: ['recalledCards', i], message: `${id} is not one of the flashcards listed` });
    });
  });
}

export function buildStepSchema(nextStage: Stage | null, expectGrade: boolean, cardIds: ReadonlySet<string> = new Set()) {
  const card = nextStage ? CardSchemas[nextStage] : z.null();
  const grade = expectGrade ? gradeFor(cardIds) : z.null();
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
  /** Attached images, as file names in the data folder's attachments/ directory. */
  attachments?: string[];
  /** The part of an earlier message the learner selected and is replying to. */
  quote?: string;
}

export interface TutorGoal {
  text: string;
  /** How deep the goal's language goes; null for goals compiled before levels existed. */
  level: GoalLevel | null;
  /** What the goal means in the learner's time. */
  scope: string | null;
  assessment: Assessment;
  focus: GoalFocus[];
  /** Why the learner wants it, what it is for, constraints, what to skip: in their words. */
  context: string | null;
}

/** Everything about the idea, the learner and the goal that a tutor call starts from. */
export type TutorContext = Omit<TutorStepInput, 'previous' | 'images' | 'cards' | 'nextStage' | 'retry'>;

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
  /** The images attached to the previous response, sent with the message; earlier answers' images are not sent again. */
  images?: LlmImage[];
  /** Flashcards on this idea and the ideas it builds on, for the grade to say which facts the response recalled. */
  cards?: { id: string; front: string; back: string }[];
  nextStage: Stage | null;
  /** The learner missed the last question of this stage: the card to produce asks it again in a fresh version. */
  retry?: boolean;
}

export interface TutorStepResult {
  grade: Grade | null;
  card: TutorCard | null;
}

/** What the tutor is told about the idea and the learner, whatever it is asked to do next. */
function contextSections(input: TutorContext): string[] {
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
  return sections;
}

export async function runTutorStep(provider: LlmProvider, input: TutorStepInput): Promise<TutorStepResult> {
  const expectGrade = input.previous !== null && isGraded(input.previous.stage);
  const sections = contextSections(input);
  if (input.previous) {
    sections.push(`## Previous card (${input.previous.stage})\n${cardText(input.previous.card)}\n\n## Learner's response\n${responseText(input.previous.response)}`);
  }
  const cards = expectGrade ? (input.cards ?? []) : [];
  if (cards.length) sections.push(`## The learner's flashcards on this idea and what it builds on\n${cards.map((c) => `- [${c.id}] ${c.front}\n  Answer: ${c.back.replace(/\n/g, ' ')}`).join('\n')}`);
  sections.push(
    input.nextStage
      ? `## Task\n${expectGrade ? 'Grade the response, then produce' : 'Produce'} the **${input.nextStage}** card.`
      : '## Task\nGrade the response. No card is needed; this node is finished.',
  );
  if (input.retry && input.nextStage) {
    sections.push(
      `The learner missed the last **${input.nextStage}** question (it is under "Earlier in this node", with their answer and your feedback). Ask about the same step again from another side: a fresh question, not the same one reworded, that the feedback they just read prepares them for. Do not explain again here.`,
    );
  }
  if (input.nextStage === 'reteach') {
    sections.push(
      'The learner has failed this idea again after a worked example. Read everything above about this idea, work out the one misunderstanding that best explains all of their answers, and write a fresh explanation that starts from it.',
    );
  }
  const result = await provider.complete({
    // the fresh explanation after a worked example goes to the escalation model
    role: input.nextStage === 'reteach' ? 'tutorEscalation' : 'tutor',
    system: answerReadingPrompt('tutor'),
    messages: [{ role: 'user', content: sections.join('\n\n'), images: input.images }],
    submit: { name: 'submit_step', description: 'Submit the grade for the previous response (or null) and the next card (or null).', schema: buildStepSchema(input.nextStage, expectGrade, new Set(cards.map((c) => c.id))) },
  });
  return result.data as TutorStepResult;
}

/** The answer key and rubric of a card that has them, as text for the tutor. */
function answerKeyOf(card: TutorCard): string | null {
  const key = 'answerKey' in card && typeof card.answerKey === 'string' ? card.answerKey : null;
  const rubric = 'rubric' in card && Array.isArray(card.rubric) ? card.rubric : [];
  if (!key && !rubric.length) return null;
  return [key ? `Answer key: ${key}` : null, rubric.length ? `Rubric: ${rubric.join('; ')}` : null].filter(Boolean).join('\n');
}

/** What the learner asked for outside the step loop: their own question, or the explanation in another form. */
export const ASIDE_MODES = ['question', 'different', 'simpler', 'example', 'hint'] as const;
export type AsideMode = (typeof ASIDE_MODES)[number];

const ASIDE_TASK: Record<AsideMode, string> = {
  question: 'Answer the learner\'s question.',
  different: 'The learner asked for the idea explained differently: explain it again from another angle than before.',
  simpler: 'The learner asked for a simpler explanation: give the core of the idea in everyday words with one concrete picture.',
  example: 'The learner asked for an example: give one small, concrete, fully worked example of the idea.',
  hint: 'The learner asked for a hint on the open question.',
};

export interface TutorAsideInput extends TutorContext {
  /** The card the learner is looking at, and whether it is a question they have not answered yet. */
  open: { stage: Stage; card: TutorCard; unanswered: boolean };
  mode: AsideMode;
  /** The learner's own words, for a question. */
  question: string;
  /** For a hint: which one this is (1 is the first), and the hints already given on this question. */
  hint?: { number: number; of: number; earlier: string[] };
}

/**
 * Answer the learner outside the step loop (design §4.2, "Asking the tutor"): a question of their
 * own, or what was explained in another form. Not graded, and no card comes of it.
 */
export async function runTutorAside(provider: LlmProvider, input: TutorAsideInput): Promise<string> {
  const sections = contextSections(input);
  sections.push(
    `## The card the learner is looking at (${input.open.stage})\n${cardText(input.open.card)}${
      input.open.unanswered ? '\n\nThis is a question the learner has not answered yet. Do not answer it for them or say anything that settles it.' : ''
    }`,
  );
  if (input.mode === 'question') sections.push(`## The learner asks\n${input.question}`);
  if (input.mode === 'hint' && input.hint) {
    const key = answerKeyOf(input.open.card);
    if (key) sections.push(`## The answer to the open question (for you only)\n${key}`);
    if (input.hint.earlier.length) sections.push(`## Hints already given on this question\n${input.hint.earlier.map((h, i) => `${i + 1}. ${h}`).join('\n')}`);
    sections.push(`## Task\n${ASIDE_TASK.hint} This is hint ${input.hint.number} of at most ${input.hint.of}.`);
  } else {
    sections.push(`## Task\n${ASIDE_TASK[input.mode]}`);
  }
  const result = await provider.complete({
    role: 'tutor',
    system: `${loadPrompt('tutor-ask')}\n\n${loadPrompt('answering')}`,
    messages: [{ role: 'user', content: sections.join('\n\n') }],
    submit: { name: 'submit_answer', description: 'Submit the answer to the learner, in Markdown.', schema: z.object({ answer: z.string().trim().min(1).max(6000) }) },
  });
  return (result.data as { answer: string }).answer;
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
  if (goal.context) lines.push(`The learner's context: ${goal.context}`);
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
  const pictures = r.attachments?.length ?? 0;
  const parts = r.quote ? [`The learner is replying to this part: "${r.quote}"`] : [];
  parts.push(r.answer.trim() ? r.answer : pictures ? '(no text: the answer is in the attached images)' : '(empty: the learner has no idea)');
  if (pictures) parts.push(`attached images: ${pictures}`);
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
  input: { goalText: string; nodes: { id: string; name: string; statement: string }[]; text: string; closing: boolean; quote?: string; images?: LlmImage[] },
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
    ...(input.quote ? [`## The learner is replying to this part\n"${input.quote}"`] : []),
    `## Learner's recall\n${input.text || (input.images?.length ? '(no text: the recall is in the attached images)' : '(nothing written)')}`,
    input.closing ? 'Score every idea and add the closing summary (canDo and previewQuestion).' : 'Score every idea. No closing summary.',
  ].join('\n\n');
  const result = await provider.complete({
    role: 'tutor',
    system: answerReadingPrompt('recall'),
    messages: [{ role: 'user', content: message, images: input.images }],
    submit: { name: 'submit_recall', description: 'Submit recall scores per idea and, when asked, the closing summary.', schema },
  });
  return result.data;
}
