import { describe, expect, it } from 'vitest';
import { mapLimit } from './map-limit.js';

const tick = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('mapLimit', () => {
  it('never runs more than the limit at once and keeps the order of the results', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await tick(5 * (7 - n));
      running -= 1;
      return n * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(2);
  });

  it('runs one at a time with a limit of 1, and handles an empty list', async () => {
    let running = 0;
    let peak = 0;
    await mapLimit([1, 2, 3], 1, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick(2);
      running -= 1;
    });
    expect(peak).toBe(1);
    expect(await mapLimit([], 3, () => Promise.resolve(1))).toEqual([]);
  });

  it('rejects on the first failure and starts nothing new afterwards', async () => {
    const started: number[] = [];
    await expect(
      mapLimit([1, 2, 3, 4, 5], 1, async (n) => {
        started.push(n);
        await tick(1);
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
    expect(started).toEqual([1, 2]);
  });
});
