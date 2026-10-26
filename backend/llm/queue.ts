import type { CompleteRequest, CompleteResult, LlmProvider } from './provider';

/** Counting semaphore. */
export class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(public limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.active += 1;
        resolve();
      });
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
    return this.semaphore.run(() => this.inner.complete(req));
  }
}
