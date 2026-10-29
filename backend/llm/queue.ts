import type { CompleteRequest, CompleteResult, LlmProvider } from './provider';
import { CancelledError } from './provider';

/** Counting semaphore. A waiter whose signal aborts leaves the queue without running. */
export class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(public limit: number) {}

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      if (signal?.aborted) throw new CancelledError();
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new CancelledError());
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const take = () => {
        signal?.removeEventListener('abort', leave);
        this.active += 1;
        resolve();
      };
      const leave = () => {
        const at = this.waiting.indexOf(take);
        if (at >= 0) this.waiting.splice(at, 1);
        reject(new CancelledError());
      };
      signal?.addEventListener('abort', leave, { once: true });
      this.waiting.push(take);
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiting.shift();
    if (next) next();
  }
}

/** Wrap a provider so at most `limit` model calls run at once (usage counts against the owner's plan). */
export class ThrottledProvider implements LlmProvider {
  readonly name: string;
  readonly semaphore: Semaphore;

  constructor(
    private readonly inner: LlmProvider,
    limit: number,
  ) {
    this.name = inner.name;
    this.semaphore = new Semaphore(limit);
  }

  complete<T>(req: CompleteRequest<T>): Promise<CompleteResult<T>> {
    return this.semaphore.run(() => this.inner.complete(req), req.signal);
  }
}
