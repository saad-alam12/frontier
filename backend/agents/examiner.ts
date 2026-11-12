import { z } from 'zod';
import type { DialogueKind, DialogueTurn } from '../store/dialogues';
import type { LlmProvider } from '../llm/provider';
import type { GoalLevel } from '../core/types';
import { loadPrompt } from './prompts';

export interface ExaminerInput {
  kind: DialogueKind;
  goal: { text: string; level: GoalLevel | null; context: string | null };
  ideas: { id: string; name: string; statement: string; ownStatement: string | null }[];
  turns: DialogueTurn[];
  /** The conversation must end now with the verdict (the learner asked to end, or it ran its length). */
  finish: boolean;
}

export const ExaminerTurnSchema = z.object({
  say: z.string().trim().max(1500).nullable().default(null),
  done: z.boolean(),
  verdict: z
    .object({
      summary: z.string().trim().min(10).max(800),
      ideas: z.array(z.object({ nodeId: z.string().min(1), score: z.number().min(0).max(10), note: z.string().trim().min(3).max(300) })),
    })
    .nullable()
    .default(null),
});
export type ExaminerTurn = z.infer<typeof ExaminerTurnSchema>;

/** A turn must ask (and not judge) or judge every idea (and ask nothing); at the end it must judge. */
export function buildExaminerSchema(ideaIds: string[], finish: boolean) {
  const ids = new Set(ideaIds);
  return ExaminerTurnSchema.superRefine((turn, ctx) => {
    if (finish && !turn.done) ctx.addIssue({ code: 'custom', path: ['done'], message: 'the conversation ends now: set done to true and give the verdict' });
    if (!turn.done && !turn.say) ctx.addIssue({ code: 'custom', path: ['say'], message: 'ask your next question in say' });
    if (turn.done && !turn.verdict) ctx.addIssue({ code: 'custom', path: ['verdict'], message: 'give the verdict' });
    if (turn.verdict) {
      const scored = new Set(turn.verdict.ideas.map((i) => i.nodeId));
      turn.verdict.ideas.forEach((i, k) => {
        if (!ids.has(i.nodeId)) ctx.addIssue({ code: 'custom', path: ['verdict', 'ideas', k, 'nodeId'], message: `${i.nodeId} is not one of the ideas` });
      });
      for (const id of ids) if (!scored.has(id)) ctx.addIssue({ code: 'custom', path: ['verdict', 'ideas'], message: `score ${id} too (0 if it did not come up)` });
    }
  });
}

const ROLE_TEXT: Record<DialogueKind, string> = {
  oral: 'You are the examiner of an oral exam.',
  teach: 'You are the curious beginner the learner teaches.',
};

/** The examiner's (or the beginner's) next turn, or the verdict. */
export async function runExaminer(provider: LlmProvider, input: ExaminerInput, onPartial?: (json: string) => void): Promise<ExaminerTurn> {
  const sections = [
    `## Your role\n${ROLE_TEXT[input.kind]}`,
    `## The learner's goal\n${input.goal.text}${input.goal.level ? `\nLevel: ${input.goal.level}.` : ''}${input.goal.context ? `\nTheir context: ${input.goal.context}` : ''}`,
    `## The ideas (for you; never read them out)\n${input.ideas.map((i) => `- [${i.id}] ${i.name}: ${i.statement}${i.ownStatement ? `\n  the learner's own words from when they learned it: "${i.ownStatement}"` : ''}`).join('\n')}`,
    `## The conversation so far\n${input.turns.length ? input.turns.map((t) => `${t.who === 'examiner' ? (input.kind === 'oral' ? 'Examiner' : 'Beginner') : 'Learner'}: ${t.text.trim() || '(no answer)'}`).join('\n\n') : '(nothing yet: open it)'}`,
    input.finish ? '## Task\nThe conversation ends now. Give the verdict.' : '## Task\nGive your next turn, or the verdict if the conversation has done its work.',
  ];
  const result = await provider.complete({
    role: 'examiner',
    system: `${loadPrompt('examiner')}\n\n${loadPrompt('answering')}`,
    messages: [{ role: 'user', content: sections.join('\n\n') }],
    onPartial,
    submit: { name: 'submit_turn', description: 'Submit your next question, or the verdict.', schema: buildExaminerSchema(input.ideas.map((i) => i.id), input.finish) },
  });
  return result.data as ExaminerTurn;
}
