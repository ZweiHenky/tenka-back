"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWorker = startWorker;
exports.startCleanupWorkers = startCleanupWorkers;
const logger_1 = require("../config/logger");
const service_1 = require("../modules/media/service");
const service_2 = require("../modules/cleanup/service");
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
            .catch((error) => logger_1.logger.error({ event: 'worker.failed', worker: name, durationMs: Date.now() - startedAt, err: error }))
            .finally(() => { active = undefined; schedule(); });
    };
    schedule();
    return async () => {
        stopped = true;
        if (timer)
            clearTimeout(timer);
        await active;
    };
}
function startCleanupWorkers(intervalMs = 60000) {
    const stopMedia = startWorker('media-cleanup', () => service_1.mediaService.processDeletionJobs(), intervalMs);
    const stopTags = startWorker('onesignal-tag-cleanup', () => service_2.cleanupService.processTagCleanupJobs(), intervalMs);
    return async () => { await Promise.all([stopMedia(), stopTags()]); };
}
//# sourceMappingURL=cleanupWorkers.js.map