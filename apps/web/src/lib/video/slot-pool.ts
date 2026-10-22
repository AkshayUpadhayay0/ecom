/**
 * Limits how many videos play at once. Cards that want to play register as claimants; the pool
 * keeps the N nearest to the middle of the viewport playing and tells the others to stay on their
 * poster. Pure logic (no DOM), so it is unit-tested directly.
 */
export interface SlotClaimant {
  id: string;
  /** Distance from the viewport centre; smaller = more important. Read at allocation time. */
  distance: () => number;
  /** A play slot was given: mount and play the video. */
  grant: () => void;
  /** The slot was taken away (or released): pause and unload the video. */
  revoke: () => void;
}

export class VideoSlotPool {
  private readonly wanting = new Map<string, SlotClaimant>();
  private readonly granted = new Set<string>();

  constructor(private readonly maxSlots: number) {
    if (maxSlots < 1) throw new Error('maxSlots must be at least 1');
  }

  /** Ask to play. Re-requesting with the same id replaces the previous claimant. */
  request(claimant: SlotClaimant): void {
    this.wanting.set(claimant.id, claimant);
    this.allocate();
  }

  /** Stop wanting a slot (left the viewport, unmounted, reduced motion switched on). */
  release(id: string): void {
    const claimant = this.wanting.get(id);
    if (!claimant) return;
    this.wanting.delete(id);
    if (this.granted.delete(id)) claimant.revoke();
    this.allocate();
  }

  /** Re-rank after scrolling (distances changed without anyone entering or leaving). */
  refresh(): void {
    this.allocate();
  }

  get activeCount(): number {
    return this.granted.size;
  }

  private allocate(): void {
    const ranked = [...this.wanting.values()]
      .map((claimant) => ({ claimant, distance: claimant.distance() }))
      .sort((a, b) => a.distance - b.distance || a.claimant.id.localeCompare(b.claimant.id))
      .slice(0, this.maxSlots)
      .map((entry) => entry.claimant);
    const winners = new Set(ranked.map((c) => c.id));

    // Revoke first so the number of playing videos never exceeds the limit, even briefly.
    for (const id of [...this.granted]) {
      if (!winners.has(id)) {
        this.granted.delete(id);
        this.wanting.get(id)?.revoke();
      }
    }
    for (const claimant of ranked) {
      if (!this.granted.has(claimant.id)) {
        this.granted.add(claimant.id);
        claimant.grant();
      }
    }
  }
}
