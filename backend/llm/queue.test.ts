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
});
