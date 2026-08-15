"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const dueProcessor_1 = require("./dueProcessor");
(0, vitest_1.describe)('createDueProcessor', () => {
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.useRealTimers();
    });
    (0, vitest_1.it)('coalesces signals and never overlaps batches', async () => {
        vitest_1.vi.useFakeTimers();
        let resolveRun;
        const run = vitest_1.vi.fn(() => new Promise((resolve) => { resolveRun = resolve; }));
        const processor = (0, dueProcessor_1.createDueProcessor)('test', run);
        processor.signal();
        await vitest_1.vi.advanceTimersByTimeAsync(0);
        processor.signal();
        processor.signal();
        await vitest_1.vi.advanceTimersByTimeAsync(10000);
        (0, vitest_1.expect)(run).toHaveBeenCalledOnce();
        resolveRun?.({ processedCount: 1, nextDueAt: null });
        await vitest_1.vi.advanceTimersByTimeAsync(0);
        (0, vitest_1.expect)(run).toHaveBeenCalledTimes(2);
        resolveRun?.({ processedCount: 0, nextDueAt: null });
        await processor.stop();
    });
    (0, vitest_1.it)('runs at the returned database due time and stop cancels it', async () => {
        vitest_1.vi.useFakeTimers();
        const dueAt = new Date(Date.now() + 5000);
        const run = vitest_1.vi.fn()
            .mockResolvedValueOnce({ processedCount: 0, nextDueAt: dueAt })
            .mockResolvedValue({ processedCount: 0, nextDueAt: null });
        const processor = (0, dueProcessor_1.createDueProcessor)('test', run);
        processor.signal();
        await vitest_1.vi.advanceTimersByTimeAsync(0);
        await vitest_1.vi.advanceTimersByTimeAsync(4999);
        (0, vitest_1.expect)(run).toHaveBeenCalledOnce();
        await vitest_1.vi.advanceTimersByTimeAsync(1);
        (0, vitest_1.expect)(run).toHaveBeenCalledTimes(2);
        processor.signal(new Date(Date.now() + 1000));
        await processor.stop();
        await vitest_1.vi.advanceTimersByTimeAsync(1000);
        (0, vitest_1.expect)(run).toHaveBeenCalledTimes(2);
    });
});
//# sourceMappingURL=dueProcessor.test.js.map