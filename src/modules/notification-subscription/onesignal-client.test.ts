import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { logger, captureException } = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
  captureException: vi.fn(),
}));

vi.mock('../../config/logger', () => ({ logger }));
vi.mock('../../instrument', () => ({ Sentry: { captureException } }));

import { removeTag } from './onesignal-client';

describe('OneSignal removeTag', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('aborts and observes requests that exceed the provider timeout', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = removeTag('subscription-id', 'division_secret');
    await vi.advanceTimersByTimeAsync(5000);

    await expect(result).resolves.toBe(false);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'onesignal',
      operation: 'remove_tag',
      timeout: true,
    }), 'Provider operation failed');
    expect(captureException).toHaveBeenCalledOnce();
  });

  it('does not read or observe response bodies, credentials, or request values', async () => {
    const text = vi.fn(() => Promise.resolve('api-key=leaked response details'));
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 401, text })));

    await expect(removeTag('private-subscription-id', 'private-tag')).resolves.toBe(false);

    expect(text).not.toHaveBeenCalled();
    const observed = JSON.stringify({ logs: logger.warn.mock.calls, events: captureException.mock.calls });
    expect(observed).not.toContain('test-onesignal-rest-api-key');
    expect(observed).not.toContain('private-subscription-id');
    expect(observed).not.toContain('private-tag');
    expect(observed).not.toContain('leaked response details');
    expect(observed).toContain('401');
  });
});
