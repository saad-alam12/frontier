import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CompleteRequest, CompleteResult, LlmProvider, Role } from './provider';
import { Semaphore, ThrottledProvider } from './queue';

describe('Semaphore', () => {
  it('never runs more than the limit at once', async () => {
    const sem = new Semaphore(3);
    let active = 0;
    let peak = 0;
    const job = () =>
      sem.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      });
    await Promise.all(Array.from({ length: 10 }, job));
    expect(peak).toBe(3);
    expect(active).toBe(0);
  });

  it('drops a waiter whose request is cancelled', async () => {
    const sem = new Semaphore(1);
    let release: () => void = () => undefined;
    const first = sem.run(() => new Promise<void>((resolve) => (release = resolve)));
    const controller = new AbortController();
    let ran = false;
    const second = sem.run(async () => {
      ran = true;
    }, controller.signal);
    controller.abort();
    await expect(second).rejects.toThrow('cancelled');
    release();
    await first;
    expect(ran).toBe(false);
    await sem.run(async () => undefined); // the slot is free again
  });
});

describe('Semaphore limit changes', () => {
  it('a higher limit lets waiters in at once; a lower one applies as calls end', async () => {
    const sem = new Semaphore(1);
    const releases: (() => void)[] = [];
    let started = 0;
    const job = () =>
      sem.run(
        () =>
          new Promise<void>((resolve) => {
            started += 1;
            releases.push(resolve);
          }),
      );
    const jobs = [job(), job(), job()];
    await Promise.resolve();
    expect(started).toBe(1);
    sem.setLimit(3);
    await Promise.resolve();
    expect(started).toBe(3);
    sem.setLimit(1);
    const fourth = job();
    releases[0]?.();
    releases[1]?.();
    await Promise.all([jobs[0], jobs[1]]);
    expect(started).toBe(3); // two ended, one still runs: the limit of one is full
    releases[2]?.();
    await jobs[2];
    await Promise.resolve();
    expect(started).toBe(4);
    releases[3]?.();
    await fourth;
  });
});

describe('ThrottledProvider', () => {
  /** A provider whose calls stay open until released; it records which roles started. */
  function held(name = 'held') {
    const started: Role[] = [];
    const open: (() => void)[] = [];
    const provider: LlmProvider = {
      name,
      complete<T>(req: CompleteRequest<T>): Promise<CompleteResult<T>> {
        started.push(req.role);
        return new Promise((resolve) => open.push(() => resolve({ data: undefined as T, usage: { inputTokens: 0, outputTokens: 0 }, attempts: 1, model: name })));
      },
    };
    return { provider, started, releaseAll: () => open.splice(0).forEach((release) => release()) };
  }
  const request = (role: Role): CompleteRequest<unknown> => ({ role, system: '', messages: [{ role: 'user', content: '' }], submit: { name: 'submit', description: '', schema: z.object({}) } });

  it('a call the learner waits on does not queue behind background work', async () => {
    const inner = held();
    const provider = new ThrottledProvider(inner.provider, 2);
    const background = [provider.complete(request('extractor')), provider.complete(request('extractor')), provider.complete(request('goalCompiler'))];
    const answer = provider.complete(request('tutor'));
    await Promise.resolve();
    expect(inner.started).toEqual(['extractor', 'extractor', 'tutor']); // the third background call waits, the tutor does not
    inner.releaseAll();
    await Promise.resolve();
    await Promise.resolve();
    inner.releaseAll();
    await Promise.all([...background, answer]);
    expect(inner.started).toEqual(['extractor', 'extractor', 'tutor', 'goalCompiler']);
  });

  it('new settings apply to later calls; calls in flight finish on the provider they started with', async () => {
    const first = held('first');
    const second = held('second');
    const provider = new ThrottledProvider(first.provider, 1);
    const inFlight = provider.complete(request('extractor'));
    await Promise.resolve();
    provider.reconfigure(second.provider, 2);
    expect(provider.name).toBe('second');
    const later = provider.complete(request('extractor'));
    await Promise.resolve();
    expect(first.started).toEqual(['extractor']);
    expect(second.started).toEqual(['extractor']);
    first.releaseAll();
    second.releaseAll();
    expect((await inFlight).model).toBe('first');
    expect((await later).model).toBe('second');
  });
});
