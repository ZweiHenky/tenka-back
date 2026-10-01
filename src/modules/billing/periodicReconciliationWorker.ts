import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { Sentry } from '../../instrument';
import type { PrismaClient } from '../../generated/prisma/client';
import { AppError } from '../../utils/errors';
import { configureRawQuerySchema } from '../../utils/rawDatabaseSchema';
import type { BatchResult } from '../../workers/dueProcessor';
import { signalBackgroundJob } from '../../workers/jobSignals';
import { assertCanonicalBillingIdentity } from './canonicalIdentity';
import { reconcileRevenueCatGoogleLedger, type BillingReconciliationResult } from './reconciliation';
import { RevenueCatProviderError } from './revenueCatClient';

const LEASE_SECONDS = 300;
const HEARTBEAT_MS = 60_000;
const MAX_RETRY_MS = 6 * 60 * 60_000;
const CRITICAL_PROVIDER_STATUSES = ['BILLING_RETRY', 'STORE_GRACE', 'ACCOUNT_HOLD', 'PAUSED'] as const;

interface ClaimedReconciliation {
  billingAccountId: string;
  consecutiveFailures: number;
}

export type ReconciliationProcessOutcome =
  | { kind: 'SUCCESS'; result: BillingReconciliationResult }
  | { kind: 'BLOCKING'; result: BillingReconciliationResult; nextDueAt: Date }
  | {
    kind: 'FAILED';
    errorCode: string;
    providerRetryable?: boolean;
    retryAfterMs?: number;
    nextDueAt: Date;
  }
  | { kind: 'LEASE_LOST' };

class ReconciliationLeaseLostError extends Error {
  constructor() {
    super('Billing periodic reconciliation lease was lost');
    this.name = 'ReconciliationLeaseLostError';
  }
}

function retryDelayMs(failures: number, retryAfterMs?: number, random = Math.random): number {
  const base = Math.min(60_000 * 2 ** Math.max(0, failures), MAX_RETRY_MS);
  const withJitter = base + Math.floor(random() * Math.max(1, base / 4));
  return Math.min(MAX_RETRY_MS, Math.max(retryAfterMs ?? 0, withJitter));
}

export async function schedulePeriodicReconciliationCandidate(
  billingAccountId: string,
  delayMinutes = env.BILLING_RECONCILIATION_ACTIVE_INTERVAL_MINUTES,
  client: PrismaClient = prisma,
): Promise<boolean> {
  let processing: boolean;
  try {
    processing = await client.$transaction(async (tx) => {
      await configureRawQuerySchema(tx);
      const [row] = await tx.$queryRaw<Array<{ processing: boolean }>>`
        INSERT INTO billing_revenuecat_reconciliations (
          "billingAccountId", status, "nextAttemptAt", "createdAt", "updatedAt"
        ) VALUES (
          ${billingAccountId}, 'SCHEDULED', NOW() + (${delayMinutes} * INTERVAL '1 minute'), NOW(), NOW()
        )
        ON CONFLICT ("billingAccountId") DO UPDATE
        SET "nextAttemptAt" = CASE
              WHEN billing_revenuecat_reconciliations.status = 'PROCESSING'
                THEN billing_revenuecat_reconciliations."nextAttemptAt"
              ELSE LEAST(billing_revenuecat_reconciliations."nextAttemptAt", EXCLUDED."nextAttemptAt")
            END,
            "requestedNextAttemptAt" = CASE
              WHEN billing_revenuecat_reconciliations.status = 'PROCESSING'
                THEN LEAST(
                  COALESCE(billing_revenuecat_reconciliations."requestedNextAttemptAt", EXCLUDED."nextAttemptAt"),
                  EXCLUDED."nextAttemptAt"
                )
              ELSE NULL
            END,
            "updatedAt" = NOW()
        RETURNING status = 'PROCESSING' AS processing
      `;
      return row.processing;
    });
  } catch {
    throw new AppError(
      503,
      'No fue posible programar la reconciliacion periodica',
      'BILLING_PERIODIC_SCHEDULE_FAILED',
    );
  }
  if (env.BILLING_REVENUECAT_ENABLED && env.BILLING_PERIODIC_RECONCILIATION_ENABLED) {
    signalBackgroundJob('billing-reconciliation');
  }
  return processing;
}

function startLeaseHeartbeat(
  billingAccountId: string,
  workerId: string,
  client: PrismaClient = prisma,
  intervalMs = HEARTBEAT_MS,
): { stop: () => Promise<boolean> } {
  let stopped = false;
  let leaseLost = false;
  let timer: NodeJS.Timeout | undefined;
  let activeRenewal = Promise.resolve();
  const schedule = () => {
    if (stopped || leaseLost) return;
    timer = setTimeout(() => {
      activeRenewal = client.$transaction(async (tx) => {
        await configureRawQuerySchema(tx);
        return tx.$executeRaw`
          UPDATE billing_revenuecat_reconciliations
          SET "leaseUntil" = NOW() + (${LEASE_SECONDS} * INTERVAL '1 second'), "updatedAt" = NOW()
          WHERE "billingAccountId" = ${billingAccountId}
            AND status = 'PROCESSING' AND "lockedBy" = ${workerId}
        `;
      }).then((count) => {
        leaseLost = count !== 1;
      }).catch((cause) => {
        leaseLost = true;
        Sentry.captureMessage('Periodic billing reconciliation lease renewal failed', {
          level: 'error',
          tags: { worker: 'billing-reconciliation', operation: 'renew_lease', errorCode: 'database_error' },
        });
      }).finally(schedule);
    }, intervalMs);
    timer.unref();
  };
  schedule();
  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await activeRenewal;
      return !leaseLost;
    },
  };
}

async function claimReconciliations(
  workerId: string,
  take: number,
  client: PrismaClient = prisma,
): Promise<ClaimedReconciliation[]> {
  return client.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    return tx.$queryRaw<ClaimedReconciliation[]>`
      WITH due AS (
        SELECT "billingAccountId"
        FROM billing_revenuecat_reconciliations
        WHERE (status IN ('SCHEDULED', 'RETRY') AND "nextAttemptAt" <= NOW())
           OR (status = 'PROCESSING' AND "leaseUntil" <= NOW())
        ORDER BY "nextAttemptAt", "billingAccountId"
        FOR UPDATE SKIP LOCKED
        LIMIT ${take}
      )
      UPDATE billing_revenuecat_reconciliations job
      SET status = 'PROCESSING', "lockedBy" = ${workerId},
          "leaseUntil" = NOW() + (${LEASE_SECONDS} * INTERVAL '1 second'),
          "requestedNextAttemptAt" = CASE
            WHEN job.status = 'PROCESSING' THEN job."requestedNextAttemptAt"
            ELSE NULL
          END,
          "lastAttemptAt" = NOW(), "updatedAt" = NOW()
      FROM due
      WHERE job."billingAccountId" = due."billingAccountId"
      RETURNING job."billingAccountId", job."consecutiveFailures"
    `;
  });
}

async function claimSpecificReconciliation(
  billingAccountId: string,
  workerId: string,
  delayMinutes: number,
  client: PrismaClient = prisma,
): Promise<{ job: ClaimedReconciliation | null; nextDueAt: Date | null }> {
  return client.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    await tx.$executeRaw`
      INSERT INTO billing_revenuecat_reconciliations (
        "billingAccountId", status, "nextAttemptAt", "createdAt", "updatedAt"
      ) VALUES (
        ${billingAccountId}, 'SCHEDULED', NOW() + (${delayMinutes} * INTERVAL '1 minute'), NOW(), NOW()
      )
      ON CONFLICT ("billingAccountId") DO UPDATE
      SET "requestedNextAttemptAt" = CASE
            WHEN billing_revenuecat_reconciliations.status = 'PROCESSING'
              THEN LEAST(
                COALESCE(
                  billing_revenuecat_reconciliations."requestedNextAttemptAt",
                  NOW() + (${delayMinutes} * INTERVAL '1 minute')
                ),
                NOW() + (${delayMinutes} * INTERVAL '1 minute')
              )
            ELSE billing_revenuecat_reconciliations."requestedNextAttemptAt"
          END,
          "updatedAt" = NOW()
    `;
    const [job] = await tx.$queryRaw<ClaimedReconciliation[]>`
      UPDATE billing_revenuecat_reconciliations
      SET status = 'PROCESSING', "lockedBy" = ${workerId},
          "leaseUntil" = NOW() + (${LEASE_SECONDS} * INTERVAL '1 second'),
          "requestedNextAttemptAt" = CASE
            WHEN status = 'PROCESSING'
              THEN LEAST(
                COALESCE("requestedNextAttemptAt", NOW() + (${delayMinutes} * INTERVAL '1 minute')),
                NOW() + (${delayMinutes} * INTERVAL '1 minute')
              )
            ELSE NOW() + (${delayMinutes} * INTERVAL '1 minute')
          END,
          "lastAttemptAt" = NOW(), "updatedAt" = NOW()
      WHERE "billingAccountId" = ${billingAccountId}
        AND (
          status = 'SCHEDULED'
          OR (status = 'RETRY' AND "nextAttemptAt" <= NOW())
          OR (status = 'PROCESSING' AND "leaseUntil" <= NOW())
        )
      RETURNING "billingAccountId", "consecutiveFailures"
    `;
    if (job) return { job, nextDueAt: null };
    const [pending] = await tx.$queryRaw<Array<{ nextDueAt: Date | null }>>`
      SELECT CASE
        WHEN status = 'PROCESSING' THEN "leaseUntil"
        ELSE "nextAttemptAt"
      END AS "nextDueAt"
      FROM billing_revenuecat_reconciliations
      WHERE "billingAccountId" = ${billingAccountId}
    `;
    return { job: null, nextDueAt: pending?.nextDueAt ? new Date(pending.nextDueAt) : null };
  });
}

async function hasCriticalProviderState(billingAccountId: string, client: PrismaClient): Promise<boolean> {
  return Boolean(await client.billingProviderSubscription.findFirst({
    where: {
      chain: { billingAccountId },
      OR: [
        { providerStatus: { in: [...CRITICAL_PROVIDER_STATUSES] } },
        { pendingLogicalProductId: { not: null } },
      ],
    },
    select: { id: true },
  }));
}

async function completeReconciliation(
  job: ClaimedReconciliation,
  workerId: string,
  result: BillingReconciliationResult,
  critical: boolean,
  client: PrismaClient,
): Promise<void> {
  const delayMinutes = critical
    ? env.BILLING_RECONCILIATION_CRITICAL_INTERVAL_MINUTES
    : env.BILLING_RECONCILIATION_ACTIVE_INTERVAL_MINUTES;
  const issuesJson = JSON.stringify(result.issues);
  const updated = await client.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    return tx.$executeRaw`
      UPDATE billing_revenuecat_reconciliations
      SET status = 'SCHEDULED', "nextAttemptAt" = LEAST(
            NOW() + (${delayMinutes} * INTERVAL '1 minute'),
            COALESCE("requestedNextAttemptAt", NOW() + (${delayMinutes} * INTERVAL '1 minute'))
          ),
          "requestedNextAttemptAt" = NULL,
          "leaseUntil" = NULL, "lockedBy" = NULL, "consecutiveFailures" = 0,
          "lastSucceededAt" = NOW(), "lastErrorCode" = NULL,
          "lastIssueSummary" = ${issuesJson}::jsonb, "updatedAt" = NOW()
      WHERE "billingAccountId" = ${job.billingAccountId}
        AND status = 'PROCESSING' AND "lockedBy" = ${workerId}
    `;
  });
  if (updated !== 1) throw new ReconciliationLeaseLostError();
}

async function deferReconciliation(
  job: ClaimedReconciliation,
  workerId: string,
  errorCode: string,
  retryAfterMs: number | undefined,
  issues: BillingReconciliationResult['issues'] | null,
  client: PrismaClient,
): Promise<Date> {
  const delayMs = issues
    ? env.BILLING_RECONCILIATION_CRITICAL_INTERVAL_MINUTES * 60_000
    : retryDelayMs(job.consecutiveFailures, retryAfterMs);
  const issuesJson = issues ? JSON.stringify(issues) : null;
  const nextDueAt = await client.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    const [updated] = await tx.$queryRaw<Array<{ nextAttemptAt: Date }>>`
      UPDATE billing_revenuecat_reconciliations
      SET status = 'RETRY', "nextAttemptAt" = LEAST(
            NOW() + (${delayMs} * INTERVAL '1 millisecond'),
            COALESCE("requestedNextAttemptAt", NOW() + (${delayMs} * INTERVAL '1 millisecond'))
          ),
          "requestedNextAttemptAt" = NULL,
          "leaseUntil" = NULL, "lockedBy" = NULL,
          "consecutiveFailures" = "consecutiveFailures" + 1,
          "lastErrorCode" = ${errorCode.slice(0, 100)},
          "lastIssueSummary" = ${issuesJson}::jsonb, "updatedAt" = NOW()
      WHERE "billingAccountId" = ${job.billingAccountId}
        AND status = 'PROCESSING' AND "lockedBy" = ${workerId}
      RETURNING "nextAttemptAt"
    `;
    return updated?.nextAttemptAt ? new Date(updated.nextAttemptAt) : null;
  });
  if (!nextDueAt) throw new ReconciliationLeaseLostError();
  return nextDueAt;
}

async function processReconciliation(
  job: ClaimedReconciliation,
  workerId: string,
  dependencies: {
    client?: PrismaClient;
    assertIdentity?: typeof assertCanonicalBillingIdentity;
    reconcile?: typeof reconcileRevenueCatGoogleLedger;
    criticalState?: typeof hasCriticalProviderState;
  } = {},
): Promise<ReconciliationProcessOutcome> {
  const client = dependencies.client ?? prisma;
  const assertIdentity = dependencies.assertIdentity ?? assertCanonicalBillingIdentity;
  const reconcile = dependencies.reconcile ?? reconcileRevenueCatGoogleLedger;
  const criticalState = dependencies.criticalState ?? hasCriticalProviderState;
  const heartbeat = startLeaseHeartbeat(job.billingAccountId, workerId, client);
  try {
    await assertIdentity(job.billingAccountId, client);
    const result = await reconcile(job.billingAccountId);
    const blocking = result.issues.some(({ severity }) => severity === 'BLOCKING');
    const critical = blocking ? true : await criticalState(job.billingAccountId, client);
    if (!await heartbeat.stop()) throw new ReconciliationLeaseLostError();
    if (blocking) {
      const nextDueAt = await deferReconciliation(
        job,
        workerId,
        'blocking_provider_evidence',
        undefined,
        result.issues,
        client,
      );
      logger.warn({
        event: 'billing.periodic_reconciliation_deferred',
        errorCode: 'blocking_provider_evidence',
        consecutiveFailures: job.consecutiveFailures + 1,
        issues: result.issues,
      }, 'Periodic billing reconciliation found blocking evidence');
      Sentry.captureMessage('Periodic RevenueCat reconciliation found blocking evidence', {
        level: 'warning',
        tags: { provider: 'revenuecat', operation: 'periodic_reconciliation' },
        extra: { issues: result.issues, consecutiveFailures: job.consecutiveFailures + 1 },
      });
      return { kind: 'BLOCKING', result, nextDueAt };
    }
    await completeReconciliation(
      job,
      workerId,
      result,
      critical,
      client,
    );
    return { kind: 'SUCCESS', result };
  } catch (cause) {
    await heartbeat.stop();
    if (cause instanceof ReconciliationLeaseLostError) {
      logger.warn({ event: 'billing.periodic_reconciliation_lease_lost' });
      return { kind: 'LEASE_LOST' };
    }
    let errorCode = 'internal_error';
    let retryAfterMs: number | undefined;
    let providerRetryable: boolean | undefined;
    if (cause instanceof RevenueCatProviderError) {
      errorCode = cause.code;
      providerRetryable = cause.retryable;
      retryAfterMs = cause.retryable
        ? cause.retryAfterMs
        : env.BILLING_RECONCILIATION_CRITICAL_INTERVAL_MINUTES * 60_000;
    } else if (cause instanceof AppError) {
      errorCode = cause.code ?? 'billing_error';
      retryAfterMs = env.BILLING_RECONCILIATION_CRITICAL_INTERVAL_MINUTES * 60_000;
    } else {
      retryAfterMs = env.BILLING_RECONCILIATION_CRITICAL_INTERVAL_MINUTES * 60_000;
      Sentry.captureMessage('Periodic billing reconciliation failed unexpectedly', {
        level: 'error',
        tags: { worker: 'billing-reconciliation', operation: 'process_job', errorCode: 'internal_error' },
      });
    }
    try {
      const nextDueAt = await deferReconciliation(job, workerId, errorCode, retryAfterMs, null, client);
      logger.warn({
        event: 'billing.periodic_reconciliation_deferred',
        errorCode,
        consecutiveFailures: job.consecutiveFailures + 1,
      }, 'Periodic billing reconciliation deferred');
      if (job.consecutiveFailures + 1 >= 3 || (cause instanceof RevenueCatProviderError && !cause.retryable)) {
        Sentry.captureMessage('Periodic RevenueCat reconciliation requires attention', {
          level: 'warning',
          tags: { provider: 'revenuecat', operation: 'periodic_reconciliation', errorCode },
          extra: { consecutiveFailures: job.consecutiveFailures + 1 },
        });
      }
      return { kind: 'FAILED', errorCode, providerRetryable, retryAfterMs, nextDueAt };
    } catch (databaseError) {
      if (!(databaseError instanceof ReconciliationLeaseLostError)) {
        Sentry.captureMessage('Periodic billing reconciliation failure could not be persisted', {
          level: 'error',
          tags: { worker: 'billing-reconciliation', operation: 'persist_failure', errorCode: 'database_error' },
        });
      }
      return { kind: 'LEASE_LOST' };
    }
  }
}

export async function reconcilePeriodicCandidateNow(
  billingAccountId: string,
  workerId: string,
  client: PrismaClient = prisma,
  reconcile: typeof reconcileRevenueCatGoogleLedger = reconcileRevenueCatGoogleLedger,
): Promise<ReconciliationProcessOutcome | { kind: 'BUSY'; nextDueAt: Date | null }> {
  const claim = await claimSpecificReconciliation(
    billingAccountId,
    workerId,
    env.BILLING_RECONCILIATION_ACTIVE_INTERVAL_MINUTES,
    client,
  );
  if (!claim.job) return { kind: 'BUSY', nextDueAt: claim.nextDueAt };
  return processReconciliation(claim.job, workerId, {
    client,
    assertIdentity: async () => undefined,
    reconcile,
  });
}

async function nextReconciliationDueAt(client: PrismaClient = prisma): Promise<Date | null> {
  const [row] = await client.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    return tx.$queryRaw<Array<{ nextDueAt: Date | null }>>`
      SELECT MIN(due_at) AS "nextDueAt" FROM (
        SELECT "nextAttemptAt" AS due_at
        FROM billing_revenuecat_reconciliations WHERE status IN ('SCHEDULED', 'RETRY')
        UNION ALL
        SELECT "leaseUntil" AS due_at
        FROM billing_revenuecat_reconciliations WHERE status = 'PROCESSING'
      ) due
    `;
  });
  return row?.nextDueAt ? new Date(row.nextDueAt) : null;
}

export async function processPeriodicReconciliations(
  take = env.BILLING_RECONCILIATION_BATCH_SIZE,
): Promise<BatchResult> {
  if (!env.BILLING_REVENUECAT_ENABLED || !env.BILLING_PERIODIC_RECONCILIATION_ENABLED) {
    return { processedCount: 0, nextDueAt: null };
  }
  const workerId = randomUUID();
  let processedCount = 0;
  for (; processedCount < take; processedCount += 1) {
    const [job] = await claimReconciliations(workerId, 1);
    if (!job) break;
    await processReconciliation(job, workerId);
  }
  if (processedCount > 0) {
    const counts = await prisma.billingRevenueCatReconciliation.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    logger.info({
      event: 'billing.periodic_reconciliation_batch_completed',
      processedCount,
      counts: Object.fromEntries(counts.map(({ status, _count }) => [status, _count._all])),
    });
  }
  return { processedCount, nextDueAt: await nextReconciliationDueAt() };
}

export const periodicReconciliationInternals = {
  LEASE_SECONDS,
  retryDelayMs,
  claimReconciliations,
  claimSpecificReconciliation,
  processReconciliation,
  nextReconciliationDueAt,
  startLeaseHeartbeat,
};
