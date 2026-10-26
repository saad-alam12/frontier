import { z } from 'zod';
import type { LlmProvider } from '../llm/provider';
import { loadPrompt } from './prompts';

export const ConnectionReply = z.object({
  greeting: z.string().min(1),
  sum: z.number().int(),
  modelSelfReport: z.string().min(1),
});
export type ConnectionReply = z.infer<typeof ConnectionReply>;

export interface ConnectionTestResult {
  ok: boolean;
  provider: string;
  model: string;
  reply?: ConnectionReply;
  attempts?: number;
  error?: string;
}

/** Asks the model for a tiny structured reply to prove the provider, auth and submit loop work. */
export async function runConnectionTest(provider: LlmProvider): Promise<ConnectionTestResult> {
  const a = 17;
  const b = 25;
  try {
    const result = await provider.complete({
      role: 'connectionTest',
      system: loadPrompt('connection-test'),
      messages: [{ role: 'user', content: `Add ${a} and ${b}. Then submit.` }],
      submit: {
        name: 'submit_connection_reply',
        description: 'Submit the connection test reply.',
        schema: ConnectionReply,
      },
    });
    const ok = result.data.sum === a + b;
    return {
      ok,
      provider: provider.name,
      model: result.model,
      reply: result.data,
      attempts: result.attempts,
      error: ok ? undefined : `expected sum ${a + b}, got ${result.data.sum}`,
    };
  } catch (error) {
    return { ok: false, provider: provider.name, model: '', error: error instanceof Error ? error.message : String(error) };
  }
}
