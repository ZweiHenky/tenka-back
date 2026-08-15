import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDueProcessor } from './dueProcessor';

describe('createDueProcessor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces signals and never overlaps batches', async () => {
    vi.useFakeTimers();
    let resolveRun: ((value: { processedCount: number; nextDueAt: Date | null }) => void) | undefined;
    const run = vi.fn(() => new Promise<{ processedCount: number; nextDueAt: Date | null }>((resolve) => { resolveRun = resolve; }));
    const processor = createDueProcessor('test', run);

    processor.signal();
    await vi.advanceTimersByTimeAsync(0);
    processor.signal();
    processor.signal();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledOnce();

    resolveRun?.({ processedCount: 1, nextDueAt: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);

    resolveRun?.({ processedCount: 0, nextDueAt: null });
    await processor.stop();
  });

  it('runs at the returned database due time and stop cancels it', async () => {
    vi.useFakeTimers();
    const dueAt = new Date(Date.now() + 5_000);
    const run = vi.fn()
      .mockResolvedValueOnce({ processedCount: 0, nextDueAt: dueAt })
      .mockResolvedValue({ processedCount: 0, nextDueAt: null });
    const processor = createDueProcessor('test', run);

    processor.signal();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);

    processor.signal(new Date(Date.now() + 1_000));
    await processor.stop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
