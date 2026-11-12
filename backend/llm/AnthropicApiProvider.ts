import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { CompleteRequest, CompleteResult, LlmMessage, LlmProvider, Role } from './provider';
import type { Effort, ModelChoice } from '../settings/schema';
import { CancelledError, NoSubmitError } from './provider';
import { SubmitTracker, runHelperTool } from './submitLoop';

export interface AnthropicApiProviderOptions {
  apiKey: string;
  modelForRole: (role: Role) => ModelChoice;
  maxTokens?: number;
}

/** Alternative provider: the public Claude API with an API key from settings. */
export class AnthropicApiProvider implements LlmProvider {
  readonly name = 'anthropicApi';
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicApiProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
  }

  async complete<T>(req: CompleteRequest<T>): Promise<CompleteResult<T>> {
    try {
      return await this.run(req);
    } catch (error) {
      if (req.signal?.aborted || error instanceof Anthropic.APIUserAbortError) throw new CancelledError();
      throw error;
    }
  }

  private async run<T>(req: CompleteRequest<T>): Promise<CompleteResult<T>> {
    const { model, effort } = this.options.modelForRole(req.role);
    const tracker = new SubmitTracker(req);
    const helperTools = req.tools ?? [];
    const messages: Anthropic.MessageParam[] = req.messages.map(toMessageParam);
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    let idleTurns = 0;

    for (;;) {
      const stream = this.client.messages.stream(requestBody(req, { model, effort, maxTokens: this.options.maxTokens }, messages), { signal: req.signal });
      if (req.onPartial) followSubmit(stream, req.submit.name, req.onPartial);
      const message = await stream.finalMessage();
      usage.inputTokens += message.usage.input_tokens;
      usage.outputTokens += message.usage.output_tokens;
      usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0;

      if (message.stop_reason === 'refusal') throw new Error(`${req.role}: the model refused the request`);
      if (message.stop_reason === 'max_tokens') throw new Error(`${req.role}: the model ran out of output tokens`);

      const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: message.content });

      if (toolUses.length === 0) {
        idleTurns += 1;
        if (idleTurns > 2) throw new NoSubmitError(req.role);
        messages.push({ role: 'user', content: `Call the ${req.submit.name} tool with your answer now.` });
        continue;
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        if (use.name === req.submit.name) {
          const verdict = tracker.trySubmit(use.input);
          if (verdict.ok) {
            results.push({ type: 'tool_result', tool_use_id: use.id, content: 'Accepted.' });
            break;
          }
          if (verdict.giveUp) throw tracker.failure();
          results.push({ type: 'tool_result', tool_use_id: use.id, content: verdict.message, is_error: true });
          continue;
        }
        const tool = helperTools.find((t) => t.name === use.name);
        if (!tool) {
          results.push({ type: 'tool_result', tool_use_id: use.id, content: `Unknown tool ${use.name}`, is_error: true });
          continue;
        }
        const out = await runHelperTool(tool, use.input);
        results.push({ type: 'tool_result', tool_use_id: use.id, content: out.text, is_error: out.isError || undefined });
      }
      if (tracker.accepted) {
        return { data: tracker.accepted.data, usage, attempts: tracker.attempts, model };
      }
      messages.push({ role: 'user', content: results });
    }
  }
}

/**
 * The request for one turn of a call. The fixed part of a role's calls (its tools, then its system
 * prompt) is cached: a breakpoint on the system prompt covers both. Automatic caching adds one at the
 * end of the conversation, so a second turn of the same call (a submit sent back for a fix) reads the
 * first from the cache.
 */
export function requestBody(req: CompleteRequest<unknown>, choice: { model: string; effort: Effort; maxTokens?: number }, messages: Anthropic.MessageParam[]): Anthropic.MessageCreateParamsNonStreaming {
  const tools: Anthropic.Tool[] = [
    ...(req.tools ?? []).map((t) => ({ name: t.name, description: t.description, input_schema: toInputSchema(t.schema) })),
    // a call that shows its text as it is written gets the submit input as the model writes it, not in one
    // piece at the end; the input is validated with zod either way
    { name: req.submit.name, description: req.submit.description, input_schema: toInputSchema(req.submit.schema), ...(req.onPartial ? { eager_input_streaming: true } : {}) },
  ];
  return {
    model: choice.model,
    // thinking counts toward max_tokens, so the higher levels get more room
    max_tokens: choice.maxTokens ?? (choice.effort === 'xhigh' || choice.effort === 'max' ? 64000 : 32000),
    output_config: { effort: choice.effort },
    system: [{ type: 'text', text: `${req.system}\n\nWhen you are done, call the ${req.submit.name} tool exactly once with your final answer.`, cache_control: { type: 'ephemeral' } }],
    cache_control: { type: 'ephemeral' },
    tools,
    messages,
  };
}

/** Pass the submit tool's input on as it streams in. */
function followSubmit(stream: { on: (event: 'streamEvent', listener: (event: Anthropic.MessageStreamEvent) => void) => unknown }, submitName: string, onPartial: (json: string) => void): void {
  let index: number | null = null;
  let json = '';
  stream.on('streamEvent', (event: Anthropic.MessageStreamEvent) => {
    if (event.type === 'content_block_start' && event.content_block.type === 'tool_use' && event.content_block.name === submitName) {
      index = event.index;
      json = '';
    } else if (event.type === 'content_block_delta' && event.index === index && event.delta.type === 'input_json_delta') {
      json += event.delta.partial_json;
      onPartial(json);
    }
  });
}

/** Text first, then any images as base64 image blocks, so the model reads the answer before looking at what it shows. */
export function toMessageParam(m: LlmMessage): Anthropic.MessageParam {
  if (m.role !== 'user' || !m.images?.length) return { role: m.role, content: m.content };
  const images: Anthropic.ImageBlockParam[] = m.images.map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } }));
  return { role: 'user', content: [{ type: 'text', text: m.content }, ...images] };
}

function toInputSchema(schema: z.ZodType): Anthropic.Tool.InputSchema {
  const json = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as Record<string, unknown>;
  delete json.$schema;
  return { ...json, type: 'object' } as Anthropic.Tool.InputSchema;
}
