import type { z } from 'zod';

/** Every model call carries one of these role names; settings map roles to models. */
export const ROLES = [
  'goalCompiler',
  'prober',
  'planner',
  'tutor',
  'tutorEscalation',
  'extractor',
  'matcher',
  'problemGenerator',
  'grader',
  'librarian',
  'connectionTest',
] as const;
export type Role = (typeof ROLES)[number];

/** An image sent to the model with a user message: base64 bytes and their type. */
export interface LlmImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  data: string;
}

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Images that follow the text of a user message (the learner's attached screenshots). */
  images?: LlmImage[];
}

/** A helper tool the agent may call before submitting (for example, to fetch a source excerpt). */
export interface HelperTool {
  name: string;
  description: string;
  schema: z.ZodType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (input: any) => Promise<string>;
}

/** Build a helper tool whose handler is typed from its schema. */
export function defineTool<I>(name: string, description: string, schema: z.ZodType<I>, run: (input: I) => Promise<string>): HelperTool {
  return { name, description, schema, run };
}

export interface SubmitTool<T> {
  name: string;
  description: string;
  schema: z.ZodType<T>;
}

export interface CompleteRequest<T> {
  role: Role;
  system: string;
  messages: LlmMessage[];
  tools?: HelperTool[];
  submit: SubmitTool<T>;
  /** Validation errors sent back to the model before giving up. Default 3. */
  maxRetries?: number;
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export interface CompleteResult<T> {
  data: T;
  usage: Usage;
  /** Number of submit attempts the model made, including the accepted one. */
  attempts: number;
  model: string;
}

export interface LlmProvider {
  readonly name: string;
  complete<T>(req: CompleteRequest<T>): Promise<CompleteResult<T>>;
}

export class SubmitValidationError extends Error {
  constructor(
    public readonly role: Role,
    public readonly attempts: number,
    public readonly lastError: string,
  ) {
    super(`${role}: submit payload still invalid after ${attempts} attempts: ${lastError}`);
    this.name = 'SubmitValidationError';
  }
}

export class NoSubmitError extends Error {
  constructor(public readonly role: Role) {
    super(`${role}: the model ended without calling the submit tool`);
    this.name = 'NoSubmitError';
  }
}

/** The learner stopped the call (Esc). The message is what the renderer checks for. */
export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

export function isCancelled(error: unknown): boolean {
  return error instanceof CancelledError || (error instanceof Error && error.message === 'cancelled');
}

export const DEFAULT_MAX_RETRIES = 3;
