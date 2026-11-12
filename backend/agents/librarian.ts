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
        if (!ids.has(id)) ctx.addIssue({ code: 'custom', path: ['cited', i], message: `${id} is not one of the cards or passages you were given` });
      });
    });
}

/** A passage of the learner's sources, with where it is (title and page). */
export interface LibrarianPassage {
  id: string;
  where: string;
  text: string;
}

/** Longest passage text the librarian reads; the full-text match is somewhere in it. */
const PASSAGE_CHARS = 1800;

/**
 * A short answer to the learner's question, built only from their own idea cards and passages of their
 * own sources; with the conversation so far for a follow-up.
 */
export async function askLibrarian(
  provider: LlmProvider,
  question: string,
  cards: LibrarianCard[],
  extra: { passages?: LibrarianPassage[]; history?: { question: string; answer: string }[] } = {},
): Promise<{ answer: string; cited: string[] }> {
  const body = cards
    .map((c) => `### [${c.id}] ${c.name}\n${c.statement}${c.ownStatement ? `\nIn the learner's words: "${c.ownStatement}"` : ''}${c.builtOn.length ? `\nBuilt on: ${c.builtOn.join('; ')}` : ''}`)
    .join('\n\n');
  const passages = extra.passages ?? [];
  const history = extra.history ?? [];
  const sections = [
    ...(history.length ? [`## The conversation so far\n${history.map((t) => `Learner: ${t.question}\nYou: ${t.answer}`).join('\n\n')}`] : []),
    `## ${history.length ? 'Follow-up question' : 'Question'}\n${question}`,
    `## The learner's idea cards\n${body || '(none matched)'}`,
    ...(passages.length ? [`## Passages from the learner's sources\n${passages.map((p) => `### [${p.id}] ${p.where}\n${p.text.length > PASSAGE_CHARS ? `${p.text.slice(0, PASSAGE_CHARS)}…` : p.text}`).join('\n\n')}`] : []),
  ];
  const ids = new Set([...cards.map((c) => c.id), ...passages.map((p) => p.id)]);
  const result = await provider.complete({
    role: 'librarian',
    system: loadPrompt('librarian'),
    messages: [{ role: 'user', content: sections.join('\n\n') }],
    submit: { name: 'submit_answer', description: 'Submit the short answer and the ids of the cards and passages it rests on.', schema: buildLibrarianSchema(ids) },
  });
  return result.data;
}
