/**
 * The Agent SDK provider's own code (design §11.2), with the SDK replaced by a stand-in: what a call
 * passes to the SDK, the submit tool's retry loop, the input streamed as it is written, usage, and
 * how a stop by the learner and a failed run come back. No model, no network, no Claude Code binary.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

interface ToolDef {
  name: string;
  handler: (input: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
}
interface QueryCall {
  options: Record<string, unknown> & { abortController: AbortController; mcpServers: Record<string, { tools: ToolDef[] }> };
}
/** What the stand-in model does in a run: given the submit tool, yields SDK messages. */
let script: (submit: ToolDef, call: QueryCall) => AsyncGenerator<unknown>;
const calls: QueryCall[] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  class AbortError extends Error {}
  return {
    AbortError,
    tool: (name: string, _description: string, _shape: unknown, handler: ToolDef['handler']) => ({ name, handler }),
    createSdkMcpServer: (config: { tools: ToolDef[] }) => ({ tools: config.tools }),
    query: (call: QueryCall) => {
      calls.push(call);
      const submit = Object.values(call.options.mcpServers)[0]?.tools.find((t) => t.name.startsWith('submit')) as ToolDef;
      return script(submit, call);
    },
  };
});

const { AgentSdkProvider } = await import('./AgentSdkProvider');
const { CancelledError, NoSubmitError } = await import('./provider');

const provider = () => new AgentSdkProvider({ cwd: '/tmp/agent', modelForRole: () => ({ model: 'claude-opus-5-5', effort: 'medium' }) });
const request = (extra: Record<string, unknown> = {}) => ({
  role: 'tutor' as const,
  system: 'You teach.',
  messages: [{ role: 'user' as const, content: 'Explain it.' }],
  submit: { name: 'submit_step', description: 'Submit.', schema: z.object({ markdown: z.string().min(3) }) },
  ...extra,
});
const result = (subtype = 'success') => ({ type: 'result', subtype, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80, cache_creation_input_tokens: 0 }, total_cost_usd: 0.01, errors: ['it broke'] });

describe('AgentSdkProvider', () => {
  it('gives the call only the app’s own tools, retries an invalid submit, and reports usage', async () => {
    const answers: { text: string; isError?: boolean }[] = [];
    script = async function* (submit) {
      yield { type: 'system', subtype: 'init', tools: ['mcp__frontier__submit_step'], mcp_servers: [{ name: 'frontier', status: 'connected' }], permissionMode: 'default' };
      const first = await submit.handler({ markdown: 'x' });
      answers.push({ text: first.content[0]?.text ?? '', isError: first.isError });
      const second = await submit.handler({ markdown: 'A full explanation.' });
      answers.push({ text: second.content[0]?.text ?? '', isError: second.isError });
      yield result();
    };
    const done = await provider().complete(request());
    expect(done.data).toEqual({ markdown: 'A full explanation.' });
    expect(done.attempts).toBe(2);
    expect(done.usage).toMatchObject({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 80 });
    expect(answers[0]?.isError).toBe(true);
    expect(answers[1]?.text).toBe('Accepted.');
    const options = calls.at(-1)?.options;
    // no built-in tools, no connectors or settings from the learner's account
    expect(options).toMatchObject({ tools: [], strictMcpConfig: true, settingSources: [], allowedTools: ['mcp__frontier__*'], persistSession: false, model: 'claude-opus-5-5', effort: 'medium' });
    expect(String(options?.systemPrompt)).toContain('call the submit_step tool exactly once');
  });

  it('streams the submit input as it is written when asked', async () => {
    script = async function* (submit) {
      yield { type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'mcp__frontier__submit_step' } } };
      yield { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"markdown":"A full' } } };
      yield { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ' explanation."}' } } };
      await submit.handler({ markdown: 'A full explanation.' });
      yield result();
    };
    const partial: string[] = [];
    await provider().complete(request({ onPartial: (json: string) => partial.push(json) }));
    expect(partial).toEqual(['{"markdown":"A full', '{"markdown":"A full explanation."}']);
    expect(calls.at(-1)?.options.includePartialMessages).toBe(true);
  });

  it('a stop by the learner is a cancellation; a run that never submits or fails says so', async () => {
    const controller = new AbortController();
    script = async function* (_submit, call) {
      controller.abort();
      call.options.abortController.abort();
      yield result();
    };
    await expect(provider().complete(request({ signal: controller.signal }))).rejects.toBeInstanceOf(CancelledError);

    script = async function* () {
      yield result();
    };
    await expect(provider().complete(request())).rejects.toBeInstanceOf(NoSubmitError);

    script = async function* () {
      yield result('error_during_execution');
    };
    await expect(provider().complete(request())).rejects.toThrow(/tutor: agent run failed \(it broke\)/);
  });
});
