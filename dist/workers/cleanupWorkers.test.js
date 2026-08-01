"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const cleanupWorkers_1 = require("./cleanupWorkers");
const flushPromises = () => Promise.resolve();
(0, vitest_1.describe)('startWorker', () => {
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.useRealTimers();
    });
    (0, vitest_1.it)('does not overlap runs', async () => {
        vitest_1.vi.useFakeTimers();
        let resolveRun;
        const run = vitest_1.vi.fn(() => new Promise((resolve) => { resolveRun = resolve; }));
        const stop = (0, cleanupWorkers_1.startWorker)('test', run, 1000);
        await vitest_1.vi.advanceTimersByTimeAsync(5000);
        (0, vitest_1.expect)(run).toHaveBeenCalledTimes(1);
        resolveRun?.();
        await flushPromises();
        await vitest_1.vi.advanceTimersByTimeAsync(999);
        (0, vitest_1.expect)(run).toHaveBeenCalledTimes(1);
        await vitest_1.vi.advanceTimersByTimeAsync(1);
        (0, vitest_1.expect)(run).toHaveBeenCalledTimes(2);
        resolveRun?.();
        await stop();
    });
    (0, vitest_1.it)('stop prevents future scheduling', async () => {
        vitest_1.vi.useFakeTimers();
        const run = vitest_1.vi.fn(async () => undefined);
        const stop = (0, cleanupWorkers_1.startWorker)('test', run, 1000);
        await stop();
        await vitest_1.vi.advanceTimersByTimeAsync(5000);
        (0, vitest_1.expect)(run).not.toHaveBeenCalled();
        (0, vitest_1.expect)(vitest_1.vi.getTimerCount()).toBe(0);
    });
});
//# sourceMappingURL=cleanupWorkers.test.js.map