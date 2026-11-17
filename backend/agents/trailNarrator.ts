import { z } from 'zod';
import type { LlmProvider } from '../llm/provider';
import { answerReadingPrompt } from './prompts';

export const NarrationSchema = z.object({
  title: z.string().trim().min(3).max(120),
  story: z.string().trim().min(60).max(3500),
});
export type Narration = z.infer<typeof NarrationSchema>;

/**
 * The story of one or more sessions, told to the learner (design §8, "Trails"): a digest of what was
 * taught, how each idea went and what they asked goes in; a title and a short story come out. Nothing is
 * graded and nothing is written to the map: it only reads what the sessions already stored.
 */
export async function runTrailNarrator(provider: LlmProvider, digest: string, signal?: AbortSignal): Promise<Narration> {
  const result = await provider.complete({
    role: 'librarian',
    system: answerReadingPrompt('trail-narrator'),
    messages: [{ role: 'user', content: digest }],
    submit: { name: 'submit_narration', description: 'Submit the title and the story of these sessions.', schema: NarrationSchema },
    signal,
  });
  return result.data;
}
