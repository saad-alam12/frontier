import type { CompleteRequest, CompleteResult, LlmProvider } from './provider';
import { CancelledError } from './provider';

/**
 * Esc after an answer (design §4.4): the learner may stop a request until its first model call has
 * answered. Callers write nothing before that call, so stopping leaves no trace; once it answers, the
 * request commits and runs to the end.
 */
export class CommitGate {
  private readonly controller = new AbortController();
  private committed = false;

  /** `onCommit` runs once the first call has answered, so a screen can stop offering Stop. */
  constructor(private readonly onCommit?: () => void) {}

  /** True until the first call has answered. */
  get stoppable(): boolean {
    return !this.committed && !this.controller.signal.aborted;
  }

  /** Stop the request if it has not committed yet. True when it will stop. */
  cancel(): boolean {
    if (this.committed) return false;
    this.controller.abort();
    return true;
  }

  /** The provider to use for the request: its first call carries the gate's signal. */
  wrap(provider: LlmProvider): LlmProvider {
    return { name: provider.name, complete: <T>(req: CompleteRequest<T>) => this.complete(provider, req) };
  }

  private async complete<T>(provider: LlmProvider, req: CompleteRequest<T>): Promise<CompleteResult<T>> {
    if (this.committed) return provider.complete(req);
    const signal = this.controller.signal;
    const call = provider.complete({ ...req, signal });
    // the learner gets the answer back at once; the provider winds down in the background
    call.catch(() => undefined);
    const result = await Promise.race([call, whenAborted(signal)]);
    if (signal.aborted) throw new CancelledError();
    this.committed = true;
    this.onCommit?.();
    return result;
  }
}

function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(new CancelledError());
    else signal.addEventListener('abort', () => reject(new CancelledError()), { once: true });
  });
}
