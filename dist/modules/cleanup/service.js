"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupService = void 0;
const node_crypto_1 = require("node:crypto");
const database_1 = require("../../config/database");
const logger_1 = require("../../config/logger");
const instrument_1 = require("../../instrument");
const onesignal_client_1 = require("../notification-subscription/onesignal-client");
async function claimTagJobs(workerId, take = 20) {
    return database_1.prisma.$queryRaw `
    WITH exhausted AS (
      UPDATE onesignal_tag_cleanup_jobs
      SET status = 'DEAD', "deadAt" = NOW(), "lockedBy" = NULL, "leaseUntil" = NULL,
          "lastError" = 'lease_expired_after_max_attempts', "updatedAt" = NOW()
      WHERE status = 'PROCESSING' AND "leaseUntil" <= NOW() AND attempts >= "maxAttempts"
    ), due AS (
      SELECT id FROM onesignal_tag_cleanup_jobs
      WHERE attempts < "maxAttempts" AND (
        (status = 'PENDING' AND "nextTryAt" <= NOW())
        OR (status = 'PROCESSING' AND "leaseUntil" <= NOW())
      )
      ORDER BY "nextTryAt"
      FOR UPDATE SKIP LOCKED
      LIMIT ${take}
    )
    UPDATE onesignal_tag_cleanup_jobs job
    SET status = 'PROCESSING', attempts = job.attempts + 1, "lockedBy" = ${workerId},
        "leaseUntil" = NOW() + INTERVAL '60 seconds', "updatedAt" = NOW()
    FROM due WHERE job.id = due.id
    RETURNING job.id, job."oneSignalId", job.tag, job.desired, job.attempts, job."maxAttempts"
  `;
}
async function processTagJob(job, workerId) {
    try {
        await (0, onesignal_client_1.syncTag)(job.oneSignalId, job.tag, job.desired);
        await database_1.prisma.oneSignalTagCleanupJob.updateMany({
            where: { id: job.id, lockedBy: workerId, status: 'PROCESSING' },
            data: { status: 'SYNCED', lockedBy: null, leaseUntil: null, lastError: null },
        });
    }
    catch (cause) {
        const providerError = cause instanceof onesignal_client_1.OneSignalProviderError ? cause : null;
        if (!providerError)
            instrument_1.Sentry.captureException(cause, { tags: { worker: 'onesignal-tag-sync', operation: 'process_job' } });
        const attempts = job.attempts;
        const dead = providerError ? (!providerError.retryable || attempts >= job.maxAttempts) : attempts >= job.maxAttempts;
        const base = Math.min(5000 * 2 ** Math.max(0, attempts - 1), 3600000);
        const delay = Math.max(providerError?.retryAfterMs ?? 0, base + Math.floor(Math.random() * Math.max(1, base / 4)));
        try {
            const result = await database_1.prisma.oneSignalTagCleanupJob.updateMany({
                where: { id: job.id, lockedBy: workerId, status: 'PROCESSING' },
                data: {
                    status: dead ? 'DEAD' : 'PENDING', attempts, deadAt: dead ? new Date() : null,
                    nextTryAt: new Date(Date.now() + delay), lastError: (providerError?.code ?? 'internal_error').slice(0, 100),
                    lockedBy: null, leaseUntil: null,
                },
            });
            if (dead && providerError && result.count === 1) {
                instrument_1.Sentry.captureException(providerError, { tags: { provider: 'onesignal', operation: 'sync_tag', terminal: 'true' }, extra: { attempts } });
            }
        }
        catch (databaseError) {
            instrument_1.Sentry.captureException(databaseError, { tags: { worker: 'onesignal-tag-sync', operation: 'persist_failure' } });
            return;
        }
        logger_1.logger.warn({ provider: 'onesignal', operation: 'sync_tag', attempts, dead, errorCode: providerError?.code ?? 'internal_error' }, 'Tag sync job failed');
    }
}
async function nextTagCleanupDueAt() {
    const [row] = await database_1.prisma.$queryRaw `
    SELECT MIN(due_at) AS "nextDueAt" FROM (
      SELECT "nextTryAt" AS due_at FROM onesignal_tag_cleanup_jobs
      WHERE status = 'PENDING' AND attempts < "maxAttempts"
      UNION ALL
      SELECT "leaseUntil" AS due_at FROM onesignal_tag_cleanup_jobs
      WHERE status = 'PROCESSING'
    ) due
  `;
    return row?.nextDueAt ? new Date(row.nextDueAt) : null;
}
async function processTagCleanupJobs(take = 20) {
    const workerId = (0, node_crypto_1.randomUUID)();
    const jobs = await claimTagJobs(workerId, take);
    await Promise.all(jobs.map((job) => processTagJob(job, workerId)));
    return { processedCount: jobs.length, nextDueAt: await nextTagCleanupDueAt() };
}
exports.cleanupService = { claimTagJobs, processTagJob, nextTagCleanupDueAt, processTagCleanupJobs };
//# sourceMappingURL=service.js.map