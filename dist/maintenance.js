"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("./instrument");
const database_1 = require("./config/database");
const logger_1 = require("./config/logger");
const instrument_1 = require("./instrument");
const cleanupWorkers_1 = require("./workers/cleanupWorkers");
const MAX_BATCHES_PER_JOB = 1000;
async function runMaintenance() {
    const definitions = (0, cleanupWorkers_1.backgroundJobDefinitions)();
    definitions.sort((a, b) => Number(a.name === 'media-deletion') - Number(b.name === 'media-deletion'));
    for (const job of definitions) {
        let processedCount = 0;
        let nextDueAt = null;
        for (let batch = 0; batch < MAX_BATCHES_PER_JOB; batch += 1) {
            const result = await job.run();
            processedCount += result.processedCount;
            nextDueAt = result.nextDueAt;
            if (result.processedCount === 0 || !nextDueAt || nextDueAt.getTime() > Date.now())
                break;
        }
        logger_1.logger.info({ event: 'maintenance.job_completed', worker: job.name, processedCount, nextDueAt });
    }
}
async function main() {
    try {
        await runMaintenance();
    }
    catch (error) {
        instrument_1.Sentry.captureException(error);
        logger_1.logger.fatal({ event: 'maintenance.failed', err: error });
        process.exitCode = 1;
    }
    finally {
        await database_1.prisma.$disconnect();
        await instrument_1.Sentry.close(2000);
    }
}
void main();
//# sourceMappingURL=maintenance.js.map