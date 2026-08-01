"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const { logger, captureException } = vitest_1.vi.hoisted(() => ({
    logger: {
        info: vitest_1.vi.fn(),
        warn: vitest_1.vi.fn(),
    },
    captureException: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../config/logger', () => ({ logger }));
vitest_1.vi.mock('../../instrument', () => ({ Sentry: { captureException } }));
const onesignal_client_1 = require("./onesignal-client");
(0, vitest_1.describe)('OneSignal removeTag', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.useFakeTimers();
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.unstubAllGlobals();
        vitest_1.vi.useRealTimers();
    });
    (0, vitest_1.it)('aborts and observes requests that exceed the provider timeout', async () => {
        const fetchMock = vitest_1.vi.fn((_url, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }));
        vitest_1.vi.stubGlobal('fetch', fetchMock);
        const result = (0, onesignal_client_1.removeTag)('subscription-id', 'division_secret');
        await vitest_1.vi.advanceTimersByTimeAsync(5000);
        await (0, vitest_1.expect)(result).resolves.toBe(false);
        (0, vitest_1.expect)(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
        (0, vitest_1.expect)(logger.warn).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            provider: 'onesignal',
            operation: 'remove_tag',
            timeout: true,
        }), 'Provider operation failed');
        (0, vitest_1.expect)(captureException).toHaveBeenCalledOnce();
    });
    (0, vitest_1.it)('does not read or observe response bodies, credentials, or request values', async () => {
        const text = vitest_1.vi.fn(() => Promise.resolve('api-key=leaked response details'));
        vitest_1.vi.stubGlobal('fetch', vitest_1.vi.fn(() => Promise.resolve({ ok: false, status: 401, text })));
        await (0, vitest_1.expect)((0, onesignal_client_1.removeTag)('private-subscription-id', 'private-tag')).resolves.toBe(false);
        (0, vitest_1.expect)(text).not.toHaveBeenCalled();
        const observed = JSON.stringify({ logs: logger.warn.mock.calls, events: captureException.mock.calls });
        (0, vitest_1.expect)(observed).not.toContain('test-onesignal-rest-api-key');
        (0, vitest_1.expect)(observed).not.toContain('private-subscription-id');
        (0, vitest_1.expect)(observed).not.toContain('private-tag');
        (0, vitest_1.expect)(observed).not.toContain('leaked response details');
        (0, vitest_1.expect)(observed).toContain('401');
    });
});
//# sourceMappingURL=onesignal-client.test.js.map