"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupService = void 0;
const database_1 = require("../../config/database");
const logger_1 = require("../../config/logger");
const onesignal_client_1 = require("../notification-subscription/onesignal-client");
exports.cleanupService = {
    async processTagCleanupJobs() {
        const jobs = await database_1.prisma.oneSignalTagCleanupJob.findMany({
            where: { nextTryAt: { lte: new Date() } },
            take: 20,
        });
        for (const job of jobs) {
            const ok = await (0, onesignal_client_1.removeTag)(job.oneSignalId, job.tag);
            if (ok) {
                await database_1.prisma.oneSignalTagCleanupJob.delete({ where: { id: job.id } });
            }
            else {
                logger_1.logger.warn({ provider: 'onesignal', operation: 'remove_tag_cleanup', status: 'retry_scheduled', timeout: false, jobId: job.id, attempts: job.attempts + 1 }, 'Provider cleanup will be retried');
                await database_1.prisma.oneSignalTagCleanupJob.update({
                    where: { id: job.id },
                    data: {
                        attempts: { increment: 1 },
                        lastError: 'onesignal removeTag failed',
                        nextTryAt: new Date(Date.now() + Math.min(60000 * 2 ** job.attempts, 86400000)),
                    },
                });
            }
        }
    },
};
//# sourceMappingURL=service.js.map