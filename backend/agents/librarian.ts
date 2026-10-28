import { z } from 'zod';
import type { LlmProvider } from '../llm/provider';
import { loadPrompt } from './prompts';

export interface LibrarianCard {
  id: string;
  name: string;
  statement: string;
  ownStatement: string | null;
  builtOn: string[];
}

export function buildLibrarianSchema(ids: Set<string>) {
  return z
    .object({
      answer: z.string().trim().min(1).max(2000),
      cited: z.array(z.string()).max(8),
    })
    .superRefine((value, ctx) => {
      value.cited.forEach((id, i) => {
        if (!ids.has(id)) ctx.addIssue({ code: 'custom', path: ['cited', i], message: `${id} is not one of the cards you were given` });
      });
    });
}

/** A short answer to the learner's question, built only from their own idea cards. */
export async function askLibrarian(provider: LlmProvider, question: string, cards: LibrarianCard[]): Promise<{ answer: string; cited: string[] }> {
  const body = cards
    .map((c) => `### [${c.id}] ${c.name}\n${c.statement}${c.ownStatement ? `\nIn the learner's words: "${c.ownStatement}"` : ''}${c.builtOn.length ? `\nBuilt on: ${c.builtOn.join('; ')}` : ''}`)
    .join('\n\n');
  const result = await provider.complete({
    role: 'librarian',
    system: loadPrompt('librarian'),
    messages: [{ role: 'user', content: `## Question\n${question}\n\n## The learner's idea cards\n${body}` }],
    submit: { name: 'submit_answer', description: 'Submit the short answer and the ids of the cards it rests on.', schema: buildLibrarianSchema(new Set(cards.map((c) => c.id))) },
  });
  return result.data;
}
