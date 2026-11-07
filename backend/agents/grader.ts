import { z } from 'zod';
import { confidenceLabel } from '../core/types';
import type { LlmProvider } from '../llm/provider';
import { answerReadingPrompt } from './prompts';

export interface GradeInput {
  statement: string;
  solution: string;
  rubric: string[];
  ideas: { id: string; name: string }[];
  answer: string;
  confidence: number | null;
  /** Flashcards on the problem's ideas and what they build on, for the grade to say which facts the answer recalled. */
  cards?: { id: string; front: string; back: string }[];
}

export function buildPracticeGradeSchema(ideaIds: Set<string>, cardIds: ReadonlySet<string> = new Set()) {
  return z
    .object({
      score: z.number().min(0).max(10),
      feedback: z.string().trim().min(1).max(1200),
      ideas: z.array(z.object({ nodeId: z.string().min(1), score: z.number().min(0).max(10) })),
      misconception: z.object({ nodeId: z.string().min(1), description: z.string().trim().min(3).max(300) }).nullable().default(null),
      /** Flashcards whose fact the answer states correctly and unaided; code counts each as a "Good" review. */
      recalledCards: z.array(z.string().min(1)).max(12).default([]),
    })
    .superRefine((value, ctx) => {
      value.recalledCards.forEach((id, k) => {
        if (!cardIds.has(id)) ctx.addIssue({ code: 'custom', path: ['recalledCards', k], message: `${id} is not one of the flashcards listed` });
      });
      const seen = new Set(value.ideas.map((i) => i.nodeId));
      value.ideas.forEach((i, k) => {
        if (!ideaIds.has(i.nodeId)) ctx.addIssue({ code: 'custom', path: ['ideas', k, 'nodeId'], message: `${i.nodeId} is not one of this problem's ideas` });
      });
      for (const id of ideaIds) if (!seen.has(id)) ctx.addIssue({ code: 'custom', path: ['ideas'], message: `missing a score for ${id}` });
      if (value.misconception && !ideaIds.has(value.misconception.nodeId)) ctx.addIssue({ code: 'custom', path: ['misconception', 'nodeId'], message: 'the misconception must name one of the ideas' });
    });
}
export type PracticeGrade = z.infer<ReturnType<typeof buildPracticeGradeSchema>>;

/**
 * Grade one practice answer. An empty answer is "I don't know" and scores 0 without a model call:
 * the solution is already on screen, so there is nothing for a grader to add.
 */
export async function gradePractice(provider: LlmProvider, input: GradeInput): Promise<PracticeGrade> {
  if (!input.answer.trim()) {
    return { score: 0, feedback: 'No answer this time. The solution shows what it needed.', ideas: input.ideas.map((i) => ({ nodeId: i.id, score: 0 })), misconception: null, recalledCards: [] };
  }
  const cards = input.cards ?? [];
  const content = [
    `## Problem\n${input.statement}`,
    `## Worked solution\n${input.solution}`,
    `## Rubric\n${input.rubric.map((r) => `- ${r}`).join('\n')}`,
    `## Ideas the problem needs (score each)\n${input.ideas.map((i) => `- [${i.id}] ${i.name}`).join('\n')}`,
    ...(cards.length ? [`## The learner's flashcards on these ideas\n${cards.map((c) => `- [${c.id}] ${c.front}\n  Answer: ${c.back.replace(/\n/g, ' ')}`).join('\n')}`] : []),
    `## Learner's answer${input.confidence === null ? '' : ` (confidence: ${confidenceLabel(input.confidence)})`}\n${input.answer}`,
  ].join('\n\n');
  const result = await provider.complete({
    role: 'grader',
    system: answerReadingPrompt('grader'),
    messages: [{ role: 'user', content }],
    submit: { name: 'submit_grade', description: 'Submit the grade, feedback and a score per idea.', schema: buildPracticeGradeSchema(new Set(input.ideas.map((i) => i.id)), new Set(cards.map((c) => c.id))) },
  });
  return result.data;
}
