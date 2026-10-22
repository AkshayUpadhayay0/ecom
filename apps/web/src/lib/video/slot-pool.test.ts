import { describe, expect, it } from 'vitest';
import { VideoSlotPool, type SlotClaimant } from './slot-pool';

function claimant(id: string, distance: number) {
  const state = { id, distance, playing: false };
  const c: SlotClaimant = {
    id,
    distance: () => state.distance,
    grant: () => {
      state.playing = true;
    },
    revoke: () => {
      state.playing = false;
    },
  };
  return { state, c };
}

describe('VideoSlotPool', () => {
  it('never lets more than the limit play, and keeps the nearest ones', () => {
    const pool = new VideoSlotPool(2);
    const a = claimant('a', 300);
    const b = claimant('b', 100);
    const c = claimant('c', 200);
    for (const x of [a, b, c]) pool.request(x.c);

    expect(pool.activeCount).toBe(2);
    expect(b.state.playing).toBe(true);
    expect(c.state.playing).toBe(true);
    expect(a.state.playing).toBe(false);
  });

  it('hands a freed slot to the waiting card', () => {
    const pool = new VideoSlotPool(1);
    const a = claimant('a', 10);
    const b = claimant('b', 20);
    pool.request(a.c);
    pool.request(b.c);
    expect(b.state.playing).toBe(false);

    pool.release('a');
    expect(a.state.playing).toBe(false);
    expect(b.state.playing).toBe(true);
  });

  it('evicts the farthest card when a nearer one arrives', () => {
    const pool = new VideoSlotPool(1);
    const far = claimant('far', 500);
    const near = claimant('near', 5);
    pool.request(far.c);
    expect(far.state.playing).toBe(true);
    pool.request(near.c);
    expect(far.state.playing).toBe(false);
    expect(near.state.playing).toBe(true);
    expect(pool.activeCount).toBe(1);
  });

  it('re-ranks after scrolling', () => {
    const pool = new VideoSlotPool(1);
    const a = claimant('a', 10);
    const b = claimant('b', 20);
    pool.request(a.c);
    pool.request(b.c);
    a.state.distance = 900;
    pool.refresh();
    expect(a.state.playing).toBe(false);
    expect(b.state.playing).toBe(true);
  });

  it('revokes before granting so the limit is never exceeded mid-swap', () => {
    const pool = new VideoSlotPool(1);
    const log: string[] = [];
    const mk = (id: string, distance: number): SlotClaimant => ({
      id,
      distance: () => distance,
      grant: () => log.push(`grant ${id}`),
      revoke: () => log.push(`revoke ${id}`),
    });
    pool.request(mk('far', 100));
    pool.request(mk('near', 1));
    expect(log).toEqual(['grant far', 'revoke far', 'grant near']);
  });

  it('rejects a pool with no slots', () => {
    expect(() => new VideoSlotPool(0)).toThrow();
  });
});
