import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoSlotPool } from './slot-pool';
import { useVideoSlot } from './use-video-slot';

type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;

const observers: { callback: Callback; target: Element | null }[] = [];

class FakeIntersectionObserver {
  private readonly record: { callback: Callback; target: Element | null };
  constructor(callback: Callback) {
    this.record = { callback, target: null };
    observers.push(this.record);
  }
  observe(target: Element): void {
    this.record.target = target;
  }
  disconnect(): void {
    this.record.target = null;
  }
  unobserve(): void {}
  takeRecords(): [] {
    return [];
  }
}

function Card({ id, pool, enabled = true }: { id: string; pool: VideoSlotPool; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useVideoSlot(ref, { enabled, pool });
  return (
    <div ref={ref} data-testid={id} data-active={active ? 'yes' : 'no'}>
      {active ? <video muted data-testid={`video-${id}`} /> : null}
    </div>
  );
}

function setVisible(testId: string, isIntersecting: boolean): void {
  const record = observers.find((o) => o.target?.getAttribute('data-testid') === testId);
  if (!record) throw new Error(`no observer for ${testId}`);
  act(() => {
    record.callback([{ isIntersecting }]);
  });
}

describe('useVideoSlot', () => {
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('only asks for a video while the card is in view, and unloads it on leaving', () => {
    const pool = new VideoSlotPool(4);
    const { getByTestId, queryByTestId } = render(<Card id="a" pool={pool} />);
    expect(getByTestId('a').dataset.active).toBe('no');
    expect(queryByTestId('video-a')).toBeNull();

    setVisible('a', true);
    expect(getByTestId('a').dataset.active).toBe('yes');
    expect(queryByTestId('video-a')).not.toBeNull();

    setVisible('a', false);
    expect(getByTestId('a').dataset.active).toBe('no');
    expect(queryByTestId('video-a')).toBeNull();
  });

  it('never plays more videos than the pool allows', () => {
    const pool = new VideoSlotPool(2);
    const { container } = render(
      <>
        <Card id="a" pool={pool} />
        <Card id="b" pool={pool} />
        <Card id="c" pool={pool} />
      </>,
    );
    for (const id of ['a', 'b', 'c']) setVisible(id, true);
    expect(container.querySelectorAll('video')).toHaveLength(2);
    expect(pool.activeCount).toBe(2);
  });

  it('does not observe or play when disabled (reduced motion / data saver)', () => {
    const pool = new VideoSlotPool(2);
    const { container } = render(<Card id="a" pool={pool} enabled={false} />);
    expect(observers).toHaveLength(0);
    expect(container.querySelectorAll('video')).toHaveLength(0);
  });

  it('releases the slot on unmount', () => {
    const pool = new VideoSlotPool(1);
    const { unmount } = render(<Card id="a" pool={pool} />);
    setVisible('a', true);
    expect(pool.activeCount).toBe(1);
    unmount();
    expect(pool.activeCount).toBe(0);
  });
});
