"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWorker = startWorker;
exports.startCleanupWorkers = startCleanupWorkers;
const logger_1 = require("../config/logger");
const service_1 = require("../modules/media/service");
const service_2 = require("../modules/cleanup/service");
const service_3 = require("../modules/notification/service");
const instrument_1 = require("../instrument");
function startWorker(name, run, intervalMs) {
    let stopped = false;
    let timer;
    let active;
    const schedule = () => { if (!stopped)
        timer = setTimeout(execute, intervalMs); };
    const execute = () => {
        if (stopped)
            return;
        const startedAt = Date.now();
        active = run()
            .then(() => logger_1.logger.debug({ event: 'worker.completed', worker: name, durationMs: Date.now() - startedAt }))
            .catch((error) => {
            instrument_1.Sentry.captureException(error, { tags: { worker: name, operation: 'batch' } });
            logger_1.logger.error({ event: 'worker.failed', worker: name, durationMs: Date.now() - startedAt, err: error });
        })
            .finally(() => { active = undefined; schedule(); });
    };
    execute();
    return async () => {
        stopped = true;
        if (timer)
            clearTimeout(timer);
        await active;
    };
}
function startCleanupWorkers(intervalMs = 60000) {
    const stopMedia = startWorker('media-cleanup', () => service_1.mediaService.processDeletionJobs(), intervalMs);
    const stopIntents = startWorker('media-intent-cleanup', () => service_1.mediaService.cleanupExpiredIntents(), intervalMs);
    const stopTags = startWorker('onesignal-tag-cleanup', () => service_2.cleanupService.processTagCleanupJobs(), intervalMs);
    const stopNotifications = startWorker('notification-outbox', () => service_3.notificationService.processOutboxJobs(), intervalMs);
    return async () => { await Promise.all([stopMedia(), stopIntents(), stopTags(), stopNotifications()]); };
}
//# sourceMappingURL=cleanupWorkers.js.map