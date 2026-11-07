/**
 * The card writer (role `cardWriter`): flashcards for the hard facts of an idea the learner just
 * learned, and single drafts from a selection or a request. It writes text only; which ideas a card is
 * tagged with, which goal it belongs to and how many are kept is decided in code.
 */
import { z } from 'zod';
import { CARD_BACK_MAX, CARD_FRONT_MAX } from '../core/cards';
import type { GoalLevel, NodeKind } from '../core/types';
import type { LlmProvider } from '../llm/provider';
import { loadPrompt } from './prompts';

export const CardTextSchema = z.object({
  front: z.string().trim().min(3).max(CARD_FRONT_MAX),
  back: z.string().trim().min(1).max(CARD_BACK_MAX),
});
export type CardText = z.infer<typeof CardTextSchema>;

/** Zero to `max` cards, none asking the same question twice. */
export function buildIdeaCardsSchema(max: number) {
  return z
    .object({ cards: z.array(CardTextSchema).max(max) })
    .superRefine((value, ctx) => {
      const seen = new Set<string>();
      value.cards.forEach((c, i) => {
        const key = c.front.toLowerCase();
        if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['cards', i, 'front'], message: 'two cards ask the same question' });
        seen.add(key);
      });
    });
}

export interface CardGoal {
  text: string;
  /** How deep the goal's language goes; null when not known. */
  level: GoalLevel | null;
}

export interface IdeaCardsInput {
  /** Null for a session with no goal. */
  goal: CardGoal | null;
  idea: { name: string; kind: NodeKind; statement: string };
  /** What the session taught about the idea: explanations, worked examples, gists. */
  taught: string[];
  /** The learner's answers on the idea's steps, with the question and how they did (0–1). */
  answers: { question: string; answer: string; score: number | null }[];
  /** Cards the idea already has. */
  existing: CardText[];
  /** At most this many new cards (1–3); the caller asks only for what the goal has room for. */
  max: number;
}

export interface DraftInput {
  goal: CardGoal | null;
  /** The ideas the card will be tagged with. */
  ideas: { name: string; statement: string }[];
  /** Text the learner selected, and the whole message it was selected in. */
  selection?: { text: string; message: string };
  /** What the card should ask, in the learner's words. */
  request?: string;
  /** What the learner already wrote on the card, for "Draft it for me". */
  partial?: { front: string; back: string };
  /** The ideas' cards, shown only when the learner leaves the question to the writer: a card they asked for is written even if a similar one exists. */
  existing: CardText[];
}

const LEVEL_TEXT: Record<GoalLevel, string> = {
  intuition: 'intuition (plain words and pictures, no formulas)',
  working: 'working knowledge (the key notation and formulas, explained and used)',
  rigorous: 'rigorous (precise definitions, derivations, proofs)',
};

function goalSection(goal: CardGoal | null): string {
  if (!goal) return '## Goal\nNone: the learner chose this on their own. Keep to what a careful learner of the topic would want to know by heart.';
  return `## Goal\n${goal.text}${goal.level ? `\nLevel: ${LEVEL_TEXT[goal.level]}.` : ''}`;
}

function existingSection(existing: CardText[]): string {
  return `## Cards that already exist\n${existing.length ? existing.map((c) => `- ${c.front}\n  ${c.back.replace(/\n/g, '\n  ')}`).join('\n') : '(none)'}`;
}

/** Cards for an idea a session just finished. Zero is a normal answer. */
export async function writeIdeaCards(provider: LlmProvider, input: IdeaCardsInput): Promise<CardText[]> {
  const max = Math.max(0, Math.min(3, input.max));
  if (max === 0) return [];
  const sections = [
    '## Task: cards for an idea the learner just learned',
    goalSection(input.goal),
    `## The idea (${input.idea.kind})\n${input.idea.name}\n${input.idea.statement}`,
    `## What the session taught about it\n${input.taught.length ? input.taught.join('\n\n---\n\n') : '(no explanation was needed: the learner showed they knew it)'}`,
    `## The learner's answers\n${
      input.answers.length
        ? input.answers.map((a) => `### Question\n${a.question}\n### Answer${a.score === null ? '' : ` (scored ${a.score.toFixed(2)})`}\n${a.answer.trim() || '(no idea)'}`).join('\n\n')
        : '(none)'
    }`,
    existingSection(input.existing),
    `Write between 0 and ${max} ${max === 1 ? 'card' : 'cards'}.`,
  ];
  const result = await provider.complete({
    role: 'cardWriter',
    system: loadPrompt('card-writer'),
    messages: [{ role: 'user', content: sections.join('\n\n') }],
    submit: { name: 'submit_cards', description: 'Submit the flashcards for this idea: an empty list when it has no hard facts to memorize.', schema: buildIdeaCardsSchema(max) },
  });
  return result.data.cards;
}

/** One card, drafted from a selection or a request, for the learner to edit before saving. */
export async function draftCard(provider: LlmProvider, input: DraftInput): Promise<CardText> {
  const sections: string[] = [];
  if (input.selection) {
    sections.push('## Task: one card from text the learner selected');
    sections.push(`## The selection\n${input.selection.text}`);
    sections.push(`## The message it was selected in\n${input.selection.message}`);
  } else {
    sections.push('## Task: one card from a request');
    if (input.request?.trim()) sections.push(`## What the card should ask\n${input.request.trim()}`);
  }
  const wrote = input.partial && (input.partial.front.trim() || input.partial.back.trim()) ? input.partial : null;
  if (wrote) sections.push(`## What the learner already wrote\nFront: ${wrote.front.trim() || '(empty)'}\nBack: ${wrote.back.trim() || '(empty)'}`);
  const open = !input.selection && !input.request?.trim() && !wrote;
  if (open) sections.push('The learner left the question to you: write the one card these ideas most need, a hard fact none of the existing cards asks.');
  sections.push(goalSection(input.goal));
  sections.push(`## The ideas it belongs to\n${input.ideas.length ? input.ideas.map((i) => `- ${i.name}: ${i.statement}`).join('\n') : '(none given)'}`);
  if (open) sections.push(existingSection(input.existing));
  const result = await provider.complete({
    role: 'cardWriter',
    system: loadPrompt('card-writer'),
    messages: [{ role: 'user', content: sections.join('\n\n') }],
    submit: { name: 'submit_card', description: 'Submit the drafted flashcard: its front (the question) and back (the answer).', schema: CardTextSchema },
  });
  return result.data;
}
