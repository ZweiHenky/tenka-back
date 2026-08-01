import { afterEach, describe, expect, it, vi } from 'vitest';
import { startWorker } from './cleanupWorkers';

const flushPromises = () => Promise.resolve();

describe('startWorker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not overlap runs', async () => {
    vi.useFakeTimers();
    let resolveRun: (() => void) | undefined;
    const run = vi.fn(() => new Promise<void>((resolve) => { resolveRun = resolve; }));
    const stop = startWorker('test', run, 1000);

    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(1);

    resolveRun?.();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);

    resolveRun?.();
    await stop();
  });

  it('stop prevents future scheduling', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const stop = startWorker('test', run, 1000);

    await stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
