import { randomUUID } from 'node:crypto';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { Sentry } from '../../instrument';
import { OneSignalProviderError, syncTag } from '../notification-subscription/onesignal-client';

interface ClaimedTagJob {
  id: string;
  oneSignalId: string;
  tag: string;
  desired: boolean;
  attempts: number;
  maxAttempts: number;
}

async function claimTagJobs(workerId: string, take = 20): Promise<ClaimedTagJob[]> {
  return prisma.$queryRaw<ClaimedTagJob[]>`
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

async function processTagJob(job: ClaimedTagJob, workerId: string): Promise<void> {
  try {
    await syncTag(job.oneSignalId, job.tag, job.desired);
    await prisma.oneSignalTagCleanupJob.updateMany({
      where: { id: job.id, lockedBy: workerId, status: 'PROCESSING' },
      data: { status: 'SYNCED', lockedBy: null, leaseUntil: null, lastError: null },
    });
  } catch (cause) {
    const providerError = cause instanceof OneSignalProviderError ? cause : null;
    if (!providerError) Sentry.captureException(cause, { tags: { worker: 'onesignal-tag-sync', operation: 'process_job' } });
    const attempts = job.attempts;
    const dead = providerError ? (!providerError.retryable || attempts >= job.maxAttempts) : attempts >= job.maxAttempts;
    const base = Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
    const delay = Math.max(providerError?.retryAfterMs ?? 0, base + Math.floor(Math.random() * Math.max(1, base / 4)));
    try {
      const result = await prisma.oneSignalTagCleanupJob.updateMany({
        where: { id: job.id, lockedBy: workerId, status: 'PROCESSING' },
        data: {
          status: dead ? 'DEAD' : 'PENDING', attempts, deadAt: dead ? new Date() : null,
          nextTryAt: new Date(Date.now() + delay), lastError: (providerError?.code ?? 'internal_error').slice(0, 100),
          lockedBy: null, leaseUntil: null,
        },
      });
      if (dead && providerError && result.count === 1) {
        Sentry.captureException(providerError, { tags: { provider: 'onesignal', operation: 'sync_tag', terminal: 'true' }, extra: { attempts } });
      }
    } catch (databaseError) {
      Sentry.captureException(databaseError, { tags: { worker: 'onesignal-tag-sync', operation: 'persist_failure' } });
      return;
    }
    logger.warn({ provider: 'onesignal', operation: 'sync_tag', attempts, dead, errorCode: providerError?.code ?? 'internal_error' }, 'Tag sync job failed');
  }
}

async function processTagCleanupJobs(take = 20): Promise<void> {
  const workerId = randomUUID();
  const jobs = await claimTagJobs(workerId, take);
  await Promise.all(jobs.map((job) => processTagJob(job, workerId)));
}

export const cleanupService = { claimTagJobs, processTagJob, processTagCleanupJobs };
