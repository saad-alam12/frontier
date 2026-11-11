import type { CompleteRequest, CompleteResult, LlmProvider, Role } from './provider';
import { CancelledError, isCancelled } from './provider';

/** Counting semaphore. A waiter whose signal aborts leaves the queue without running. */
export class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(public limit: number) {}

  /** A new limit takes effect at once: a higher one lets waiters in, a lower one applies as calls end. */
  setLimit(limit: number): void {
    this.limit = limit;
    while (this.active < this.limit) {
      const next = this.waiting.shift();
      if (!next) break;
      next();
    }
  }

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
    if (this.active >= this.limit) return; // the limit was lowered while this call ran
    const next = this.waiting.shift();
    if (next) next();
  }
}

/**
 * Calls the learner is waiting on (an answer being judged, a session being planned, a lookup). They
 * get a lane of their own, so they never queue behind sources being read or goals being mapped.
 */
const WAITED_ON: ReadonlySet<Role> = new Set<Role>(['tutor', 'tutorEscalation', 'planner', 'sessionPlanner', 'prober', 'problemGenerator', 'librarian', 'connectionTest']);
const WAITED_ON_LIMIT = 2;

/**
 * Wrap a provider in two lanes. Background work (reading sources, mapping goals, grading, writing
 * cards) runs at most `limit` calls at once, because usage counts against the owner's plan; calls
 * the learner waits on run beside it, at most two at once. The provider and the limit can change
 * while the app runs: calls in flight finish as they started, later calls use the new ones.
 */
export class ThrottledProvider implements LlmProvider {
  /** The background lane. */
  readonly semaphore: Semaphore;
  private readonly waitedOn = new Semaphore(WAITED_ON_LIMIT);

  constructor(
    private inner: LlmProvider,
    limit: number,
    /** Told of every call that failed (not of one the learner stopped), for the log. */
    private readonly onError?: (role: Role, error: unknown) => void,
  ) {
    this.semaphore = new Semaphore(limit);
  }

  get name(): string {
    return this.inner.name;
  }

  reconfigure(inner: LlmProvider, limit: number): void {
    this.inner = inner;
    this.semaphore.setLimit(limit);
  }

  complete<T>(req: CompleteRequest<T>): Promise<CompleteResult<T>> {
    const lane = WAITED_ON.has(req.role) ? this.waitedOn : this.semaphore;
    return lane
      .run(() => this.inner.complete(req), req.signal)
      .catch((error: unknown) => {
        if (!isCancelled(error)) this.onError?.(req.role, error);
        throw error;
      });
  }
}
