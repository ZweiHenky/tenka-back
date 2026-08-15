"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDueProcessor = createDueProcessor;
const logger_1 = require("../config/logger");
const instrument_1 = require("../instrument");
const MAX_TIMER_MS = 2147483647;
const FAILURE_RETRY_MS = 5000;
function createDueProcessor(name, run) {
    let stopped = false;
    let active;
    let timer;
    let scheduledAt;
    let requestedAt;
    const schedule = (dueAt = new Date()) => {
        if (stopped)
            return;
        const due = dueAt.getTime();
        if (!Number.isFinite(due))
            return;
        if (active) {
            requestedAt = Math.min(requestedAt ?? due, due);
            return;
        }
        if (scheduledAt !== undefined && scheduledAt <= due)
            return;
        if (timer)
            clearTimeout(timer);
        scheduledAt = due;
        timer = setTimeout(() => {
            timer = undefined;
            scheduledAt = undefined;
            if (due > Date.now())
                schedule(new Date(due));
            else
                execute();
        }, Math.min(Math.max(0, due - Date.now()), MAX_TIMER_MS));
        timer.unref?.();
    };
    const execute = () => {
        if (stopped || active)
            return;
        timer = undefined;
        scheduledAt = undefined;
        const startedAt = Date.now();
        active = run()
            .then(({ processedCount, nextDueAt }) => {
            logger_1.logger.debug({ event: 'worker.completed', worker: name, processedCount, durationMs: Date.now() - startedAt });
            if (nextDueAt)
                requestedAt = Math.min(requestedAt ?? nextDueAt.getTime(), nextDueAt.getTime());
        })
            .catch((error) => {
            instrument_1.Sentry.captureException(error, { tags: { worker: name, operation: 'batch' } });
            logger_1.logger.error({ event: 'worker.failed', worker: name, durationMs: Date.now() - startedAt, err: error });
            requestedAt = Math.min(requestedAt ?? Infinity, Date.now() + FAILURE_RETRY_MS);
        })
            .finally(() => {
            active = undefined;
            const next = requestedAt;
            requestedAt = undefined;
            if (next !== undefined)
                schedule(new Date(next));
        });
    };
    return {
        signal: schedule,
        async stop() {
            stopped = true;
            if (timer)
                clearTimeout(timer);
            timer = undefined;
            scheduledAt = undefined;
            await active;
        },
    };
}
//# sourceMappingURL=dueProcessor.js.map