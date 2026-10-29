import type { CompleteRequest, CompleteResult, LlmProvider, Role } from './provider';
import { CancelledError, NoSubmitError } from './provider';
import { SubmitTracker, runHelperTool } from './submitLoop';

/**
 * One scripted step: a submit payload (any plain value), `{ callTool: { name, input } }` to run a helper
 * tool, `{ submit: value }` to be explicit, or a function deriving one of these from the request. A
 * function may return a promise, to hold the call open; the request's signal cancels it.
 */
export type FakeStep = unknown;

export type FakeScript = Partial<Record<Role, FakeStep[] | ((req: CompleteRequest<unknown>) => unknown)>>;

export interface FakeCall {
  role: Role;
  system: string;
  messages: CompleteRequest<unknown>['messages'];
  toolCalls: { name: string; input: unknown; output: string }[];
}

/**
 * Scripted provider for tests. Each role has a queue of steps; a plain value is a submit payload.
 * Invalid payloads are retried from the queue like a real model retry, so tests can cover the retry loop.
 */
export class FakeProvider implements LlmProvider {
  readonly name = 'fake';
  readonly calls: FakeCall[] = [];
  private readonly queues = new Map<Role, FakeStep[]>();
  private readonly fns = new Map<Role, (req: CompleteRequest<unknown>) => unknown>();

  constructor(script: FakeScript = {}) {
    for (const [role, steps] of Object.entries(script) as [Role, FakeStep[] | ((req: CompleteRequest<unknown>) => unknown)][]) {
      if (typeof steps === 'function') this.fns.set(role, steps);
      else this.queues.set(role, [...steps]);
    }
  }

  /** Add scripted steps for a role (appended). */
  script(role: Role, ...steps: FakeStep[]): void {
    const queue = this.queues.get(role) ?? [];
    queue.push(...steps);
    this.queues.set(role, queue);
  }

  async complete<T>(req: CompleteRequest<T>): Promise<CompleteResult<T>> {
    const tracker = new SubmitTracker(req);
    const call: FakeCall = { role: req.role, system: req.system, messages: req.messages, toolCalls: [] };
    this.calls.push(call);
    const anyReq = req as CompleteRequest<unknown>;

    for (;;) {
      if (req.signal?.aborted) throw new CancelledError();
      const step = this.nextStep(anyReq);
      if (step === undefined) throw new NoSubmitError(req.role);
      const produced: unknown = typeof step === 'function' ? (step as (r: CompleteRequest<unknown>) => unknown)(anyReq) : step;
      const resolved = produced instanceof Promise ? await untilAborted(produced, req.signal) : produced;
      if (isToolStep(resolved)) {
        const tool = req.tools?.find((t) => t.name === resolved.callTool.name);
        if (!tool) throw new Error(`fake script called unknown tool ${resolved.callTool.name}`);
        const out = await runHelperTool(tool, resolved.callTool.input);
        call.toolCalls.push({ name: tool.name, input: resolved.callTool.input, output: out.text });
        continue;
      }
      const payload = isSubmitStep(resolved) ? resolved.submit : resolved;
      const verdict = tracker.trySubmit(payload);
      if (verdict.ok) break;
      if (verdict.giveUp) throw tracker.failure();
    }
    if (req.signal?.aborted) throw new CancelledError();
    if (!tracker.accepted) throw new NoSubmitError(req.role);
    return { data: tracker.accepted.data, usage: { inputTokens: 0, outputTokens: 0 }, attempts: tracker.attempts, model: 'fake' };
  }

  private nextStep(req: CompleteRequest<unknown>): FakeStep | undefined {
    const queue = this.queues.get(req.role);
    if (queue && queue.length > 0) {
      // keep the last step so repeated calls of the same role keep working
      return queue.length === 1 ? queue[0] : queue.shift();
    }
    const fn = this.fns.get(req.role);
    if (fn) return fn;
    return undefined;
  }
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new CancelledError());
    signal.addEventListener('abort', stop, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', stop);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', stop);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function isToolStep(step: unknown): step is { callTool: { name: string; input: unknown } } {
  return typeof step === 'object' && step !== null && 'callTool' in step;
}

function isSubmitStep(step: unknown): step is { submit: unknown } {
  return typeof step === 'object' && step !== null && 'submit' in step && Object.keys(step).length === 1;
}
