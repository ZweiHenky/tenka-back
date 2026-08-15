"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.backgroundJobDefinitions = backgroundJobDefinitions;
exports.startCleanupWorkers = startCleanupWorkers;
const service_1 = require("../modules/cleanup/service");
const service_2 = require("../modules/media/service");
const service_3 = require("../modules/notification/service");
const dueProcessor_1 = require("./dueProcessor");
const jobSignals_1 = require("./jobSignals");
function backgroundJobDefinitions() {
    return [
        { name: 'media-deletion', run: () => service_2.mediaService.processDeletionJobs() },
        { name: 'media-intents', run: () => service_2.mediaService.cleanupExpiredIntents() },
        { name: 'tag-cleanup', run: () => service_1.cleanupService.processTagCleanupJobs() },
        { name: 'notification-outbox', run: () => service_3.notificationService.processOutboxJobs() },
    ];
}
function startCleanupWorkers() {
    const processors = backgroundJobDefinitions().map((job) => ({
        job,
        processor: (0, dueProcessor_1.createDueProcessor)(job.name, job.run),
    }));
    const unregister = processors.map(({ job, processor }) => (0, jobSignals_1.registerJobSignal)(job.name, processor.signal));
    // Recover durable work after deploys, crashes, or missed process-local signals.
    for (const { processor } of processors)
        processor.signal();
    return async () => {
        for (const remove of unregister)
            remove();
        await Promise.all(processors.map(({ processor }) => processor.stop()));
    };
}
//# sourceMappingURL=cleanupWorkers.js.map