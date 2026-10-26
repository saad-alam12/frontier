import type { z } from 'zod';
import { DEFAULT_MAX_RETRIES, SubmitValidationError } from './provider';
import type { CompleteRequest, HelperTool } from './provider';

/** Shared bookkeeping for the submit-tool loop used by every provider. */
export class SubmitTracker<T> {
  attempts = 0;
  accepted: { data: T } | null = null;
  lastError = '';
  private readonly maxRetries: number;

  constructor(private readonly req: CompleteRequest<T>) {
    this.maxRetries = req.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /** Validate a submit payload. Returns the text to send back to the model when it is invalid. */
  trySubmit(input: unknown): { ok: true } | { ok: false; message: string; giveUp: boolean } {
    this.attempts += 1;
    const parsed = this.req.submit.schema.safeParse(input);
    if (parsed.success) {
      this.accepted = { data: parsed.data };
      return { ok: true };
    }
    this.lastError = formatZodError(parsed.error);
    const giveUp = this.attempts > this.maxRetries;
    return {
      ok: false,
      giveUp,
      message: `Validation failed. Fix these problems and call ${this.req.submit.name} again:\n${this.lastError}`,
    };
  }

  failure(): SubmitValidationError {
    return new SubmitValidationError(this.req.role, this.attempts, this.lastError);
  }
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `- ${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('\n');
}

/** Run a helper tool with validated input; errors go back to the model as text. */
export async function runHelperTool(tool: HelperTool, input: unknown): Promise<{ text: string; isError: boolean }> {
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) {
    return { text: `Invalid input for ${tool.name}:\n${formatZodError(parsed.error)}`, isError: true };
  }
  try {
    return { text: await tool.run(parsed.data), isError: false };
  } catch (error) {
    return { text: `${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
  }
}

/** Flatten a multi-message conversation into one prompt for providers that accept a single prompt. */
export function flattenMessages(messages: CompleteRequest<unknown>['messages']): string {
  if (messages.length === 1 && messages[0]?.role === 'user') return messages[0].content;
  return messages
    .map((m) => (m.role === 'user' ? `<user>\n${m.content}\n</user>` : `<assistant>\n${m.content}\n</assistant>`))
    .join('\n\n');
}
