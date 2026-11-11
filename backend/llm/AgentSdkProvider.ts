/**
 * Default provider: the Claude Agent SDK, which runs the bundled Claude Code binary and uses
 * the login that is already on this machine. This is the one non-open-source dependency of the
 * project and is kept isolated here so it can be swapped out.
 */
import { AbortError, createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { CompleteRequest, CompleteResult, HelperTool, LlmImage, LlmProvider, Role } from './provider';
import type { ModelChoice } from '../settings/schema';
import { CancelledError, NoSubmitError } from './provider';
import { SubmitTracker, flattenMessages, runHelperTool } from './submitLoop';

export interface AgentSdkProviderOptions {
  modelForRole: (role: Role) => ModelChoice;
  /** Working directory for the agent process. Nothing is read from it; it keeps the SDK away from the source tree. */
  cwd: string;
  maxTurns?: number;
  /** What the model can see in a call, as the SDK reports it when the call starts (`npm run live:tools` prints it). */
  onInit?: (info: { tools: string[]; mcpServers: { name: string; status: string }[]; permissionMode: string }) => void;
}

const SERVER_NAME = 'frontier';

export class AgentSdkProvider implements LlmProvider {
  readonly name = 'agentSdk';

  constructor(private readonly options: AgentSdkProviderOptions) {}

  async complete<T>(req: CompleteRequest<T>): Promise<CompleteResult<T>> {
    if (req.signal?.aborted) throw new CancelledError();
    const { model, effort } = this.options.modelForRole(req.role);
    const tracker = new SubmitTracker(req);
    const abort = new AbortController();
    req.signal?.addEventListener('abort', () => abort.abort(), { once: true });
    let fatal: Error | null = null;

    const helperTools = (req.tools ?? []).map((t) => toSdkTool(t));
    const submitTool = tool(
      req.submit.name,
      req.submit.description,
      shapeOf(req.submit.schema),
      async (input): Promise<CallToolResult> => {
        const verdict = tracker.trySubmit(input);
        if (verdict.ok) {
          // The answer is in; stop the agent instead of letting it spend more turns.
          queueMicrotask(() => abort.abort());
          return { content: [{ type: 'text', text: 'Accepted.' }] };
        }
        if (verdict.giveUp) {
          fatal = tracker.failure();
          queueMicrotask(() => abort.abort());
        }
        return { content: [{ type: 'text', text: verdict.message }], isError: true };
      },
      { alwaysLoad: true },
    );

    const server = createSdkMcpServer({
      name: SERVER_NAME,
      version: '1.0.0',
      tools: [...helperTools, submitTool],
      alwaysLoad: true,
    });

    const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    const text = flattenMessages(req.messages);
    const images = req.messages.flatMap((m) => (m.role === 'user' ? (m.images ?? []) : []));
    const prompt = images.length ? withImages(text, images) : text;
    const system = `${req.system}\n\nWhen you are done, call the ${req.submit.name} tool exactly once with your final answer. Do not write files or run commands.`;

    try {
      const run = query({
        prompt,
        options: {
          abortController: abort,
          cwd: this.options.cwd,
          model,
          effort,
          systemPrompt: system,
          tools: [],
          mcpServers: { [SERVER_NAME]: server },
          // only the app's own in-process tools: no connectors from the learner's Claude account, user
          // settings or plugins, because calls read text from sources the learner did not write
          strictMcpConfig: true,
          allowedTools: [`mcp__${SERVER_NAME}__*`],
          settingSources: [],
          persistSession: false,
          maxTurns: this.options.maxTurns ?? 12,
        },
      });
      for await (const message of run) {
        if (message.type === 'system' && message.subtype === 'init') {
          this.options.onInit?.({ tools: message.tools, mcpServers: message.mcp_servers, permissionMode: message.permissionMode });
        }
        if (message.type === 'result') {
          usage.inputTokens += message.usage.input_tokens;
          usage.outputTokens += message.usage.output_tokens;
          usage.costUsd += message.total_cost_usd;
          if (message.subtype !== 'success' && !tracker.accepted) {
            const detail = 'errors' in message && Array.isArray(message.errors) ? message.errors.join('; ') : message.subtype;
            throw new Error(`${req.role}: agent run failed (${detail})`);
          }
        }
      }
    } catch (error) {
      if (!(error instanceof AbortError) && !isAbortLike(error)) throw error;
    }

    // the learner stopped it: whatever the model managed to submit is dropped
    if (req.signal?.aborted) throw new CancelledError();
    if (fatal) throw fatal;
    if (!tracker.accepted) throw new NoSubmitError(req.role);
    return { data: tracker.accepted.data, usage, attempts: tracker.attempts, model };
  }
}

/**
 * A string prompt can only carry text, so a prompt with images goes in as one streamed user message
 * whose content is Messages API blocks (SDKUserMessage.message is a MessageParam). The stream may end
 * right after it: with an in-process MCP server the SDK keeps stdin open until the run ends.
 */
export async function* withImages(text: string, images: LlmImage[]): AsyncIterable<SDKUserMessage> {
  yield {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [{ type: 'text', text }, ...images.map((image) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: image.mediaType, data: image.data } }))],
    },
  };
}

function toSdkTool(helper: HelperTool) {
  return tool(helper.name, helper.description, shapeOf(helper.schema), async (input): Promise<CallToolResult> => {
    const out = await runHelperTool(helper, input);
    return { content: [{ type: 'text', text: out.text }], isError: out.isError || undefined };
  });
}

/** The SDK takes a zod raw shape; tool schemas in this project are always objects. */
function shapeOf(schema: z.ZodType): z.ZodRawShape {
  if (schema instanceof z.ZodObject) return schema.shape as z.ZodRawShape;
  throw new Error('submit and helper tool schemas must be zod objects');
}

function isAbortLike(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /abort/i.test(error.message));
}
