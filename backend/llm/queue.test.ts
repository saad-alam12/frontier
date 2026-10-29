import { describe, expect, it } from 'vitest';
import { Semaphore } from './queue';

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
