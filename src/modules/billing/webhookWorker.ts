import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { Sentry } from '../../instrument';
import { Prisma, type BillingWebhookEventStatus, type PrismaClient } from '../../generated/prisma/client';
import { AppError } from '../../utils/errors';
import { configureRawQuerySchema } from '../../utils/rawDatabaseSchema';
import type { BatchResult } from '../../workers/dueProcessor';
import { signalBackgroundJob } from '../../workers/jobSignals';
import { reconcileRevenueCatGoogleLedger, type BillingReconciliationResult } from './reconciliation';
import { RevenueCatProviderError } from './revenueCatClient';
import { parseRedactedRevenueCatWebhookPayload } from './webhookInbox';
import { BillingWebhookIdentityError, resolveWebhookBillingAccount } from './webhookIdentity';
import { reconcilePeriodicCandidateNow } from './periodicReconciliationWorker';

const MAX_ATTEMPTS = 12;
const QUARANTINE_MAX_AGE_DAYS = 7;
const QUARANTINE_ALERT_MS = 60 * 60 * 1000;
const HEARTBEAT_MS = 20_000;

interface ClaimedWebhookEvent {
  id: string;
  payloadRedacted: unknown;
  attempts: number;
  receivedAt: Date;
  quarantineStartedAt: Date | null;
}

type RetryKind = 'RETRY' | 'QUARANTINED' | 'DEAD_LETTER';
type EventScope = 'GOOGLE_RECONCILIATION' | 'TEST_NO_OP';

class WebhookProcessingError extends Error {
  constructor(
    public readonly code: string,
    public readonly disposition: RetryKind,
    public readonly retryAfterMs?: number,
  ) {
    super(`RevenueCat webhook processing failed (${code})`);
    this.name = 'WebhookProcessingError';
  }
}

class WebhookLeaseLostError extends Error {
  constructor() {
    super('Billing webhook lease was lost');
    this.name = 'WebhookLeaseLostError';
  }
}

function startLeaseHeartbeat(
  jobId: string,
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
          UPDATE billing_webhook_events
          SET "leaseUntil" = NOW() + INTERVAL '60 seconds', "updatedAt" = NOW()
          WHERE id = ${jobId} AND status = 'PROCESSING' AND "lockedBy" = ${workerId}
        `;
      }).then((count) => {
        leaseLost = count !== 1;
      }).catch(() => {
        leaseLost = true;
        Sentry.captureMessage('Billing webhook lease renewal failed', {
          level: 'error',
          tags: { worker: 'billing-webhook', operation: 'renew_lease', errorCode: 'database_error' },
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

function retryDate(attempts: number, quarantined: boolean, retryAfterMs?: number): Date {
  const initial = quarantined ? 5 * 60_000 : 5_000;
  const maximum = quarantined ? 24 * 60 * 60_000 : 60 * 60_000;
  const base = Math.min(initial * 2 ** Math.max(0, attempts - 1), maximum);
  const delay = Math.max(retryAfterMs ?? 0, base + Math.floor(Math.random() * Math.max(1, base / 4)));
  return new Date(Date.now() + delay);
}

async function claimWebhookEvents(
  workerId: string,
  take = 20,
  client: PrismaClient = prisma,
): Promise<ClaimedWebhookEvent[]> {
  return client.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    return tx.$queryRaw<ClaimedWebhookEvent[]>`
      WITH due AS (
        SELECT id FROM billing_webhook_events
        WHERE attempts < ${MAX_ATTEMPTS} AND (
          (status IN ('PENDING', 'RETRY', 'QUARANTINED') AND "nextAttemptAt" <= NOW())
          OR (status = 'PROCESSING' AND "leaseUntil" <= NOW())
        )
        AND NOT (status = 'QUARANTINED'
          AND COALESCE("quarantineStartedAt", "receivedAt") <= NOW() - INTERVAL '7 days')
        ORDER BY "nextAttemptAt", "receivedAt", id
        FOR UPDATE SKIP LOCKED
        LIMIT ${take}
      )
      UPDATE billing_webhook_events event
      SET status = 'PROCESSING', attempts = event.attempts + 1, "lockedBy" = ${workerId},
          "leaseUntil" = NOW() + INTERVAL '60 seconds', "updatedAt" = NOW()
      FROM due WHERE event.id = due.id
      RETURNING event.id, event."payloadRedacted", event.attempts, event."receivedAt",
                event."quarantineStartedAt"
    `;
  });
}

async function terminalizeExhaustedEvents(client: PrismaClient = prisma): Promise<number> {
  const result = await client.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    return tx.$executeRaw`
      UPDATE billing_webhook_events
      SET status = 'DEAD_LETTER', "lockedBy" = NULL, "leaseUntil" = NULL,
          "lastError" = CASE
            WHEN status = 'QUARANTINED'
              AND COALESCE("quarantineStartedAt", "receivedAt") <= NOW() - INTERVAL '7 days'
              THEN 'quarantine_expired'
            ELSE 'attempts_exhausted'
          END,
          "updatedAt" = NOW()
      WHERE status NOT IN ('PROCESSED', 'CONFLICT', 'DEAD_LETTER') AND (
        (attempts >= ${MAX_ATTEMPTS} AND (status <> 'PROCESSING' OR "leaseUntil" <= NOW()))
        OR (status = 'QUARANTINED'
          AND COALESCE("quarantineStartedAt", "receivedAt") <= NOW() - INTERVAL '7 days')
      )
    `;
  });
  if (result > 0) {
    Sentry.captureMessage('RevenueCat webhooks moved to dead letter', {
      level: 'error',
      tags: { provider: 'revenuecat', operation: 'terminalize_webhooks' },
      extra: { count: result },
    });
    logger.error({ event: 'billing.webhook_dead_letters_created', count: result });
  }
  return result;
}

async function completeWebhookEvent(jobId: string, workerId: string, client: PrismaClient = prisma): Promise<void> {
  const result = await client.billingWebhookEvent.updateMany({
    where: { id: jobId, status: 'PROCESSING', lockedBy: workerId },
    data: {
      status: 'PROCESSED',
      processedAt: new Date(),
      leaseUntil: null,
      lockedBy: null,
      lastError: null,
      quarantineStartedAt: null,
    },
  });
  if (result.count !== 1) throw new WebhookLeaseLostError();
  signalBackgroundJob('billing-webhook-retention');
}

async function deferWebhookEvent(
  job: ClaimedWebhookEvent,
  workerId: string,
  disposition: RetryKind,
  errorCode: string,
  retryAfterMs?: number,
  client: PrismaClient = prisma,
): Promise<void> {
  const terminal = disposition === 'DEAD_LETTER' || job.attempts >= MAX_ATTEMPTS;
  const status: BillingWebhookEventStatus = terminal ? 'DEAD_LETTER' : disposition;
  const nextAttemptAt = terminal
    ? new Date()
    : retryDate(job.attempts, status === 'QUARANTINED', retryAfterMs);
  const result = await client.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    return tx.$executeRaw`
      UPDATE billing_webhook_events
      SET status = ${status}::"BillingWebhookEventStatus",
          "nextAttemptAt" = ${nextAttemptAt},
          "leaseUntil" = NULL,
          "lockedBy" = NULL,
          "lastError" = ${errorCode.slice(0, 100)},
          "quarantineStartedAt" = CASE
            WHEN ${status} = 'QUARANTINED'
              THEN COALESCE("quarantineStartedAt", NOW())
            ELSE "quarantineStartedAt"
          END,
          "updatedAt" = NOW()
      WHERE id = ${job.id} AND status = 'PROCESSING' AND "lockedBy" = ${workerId}
    `;
  });
  if (result !== 1) {
    logger.warn({ event: 'billing.webhook_lease_lost', attempts: job.attempts });
    return;
  }
  const actionableSince = status === 'QUARANTINED'
    ? job.quarantineStartedAt ?? new Date()
    : job.receivedAt;
  const ageMs = Math.max(0, Date.now() - actionableSince.getTime());
  if (terminal || (status === 'QUARANTINED' && ageMs >= QUARANTINE_ALERT_MS)) {
    Sentry.captureMessage('RevenueCat webhook requires attention', {
      level: terminal ? 'error' : 'warning',
      tags: { provider: 'revenuecat', operation: 'process_webhook', status, errorCode },
      extra: { attempts: job.attempts, ageMs },
    });
  }
  logger.warn({
    event: 'billing.webhook_deferred',
    status,
    errorCode,
    attempts: job.attempts,
    ageMs,
  }, 'Billing webhook processing deferred');
}

function assertEventScope(payload: ReturnType<typeof parseRedactedRevenueCatWebhookPayload>): EventScope {
  const expectedEnvironment = env.APP_ENV === 'production' ? 'PRODUCTION' : 'SANDBOX';
  const eventEnvironment = payload.event.environment?.toUpperCase();
  const store = payload.event.store?.toUpperCase();
  if (payload.event.type.toUpperCase() === 'TEST') {
    if (eventEnvironment === 'SANDBOX' && (store === 'APP_STORE' || store === 'PLAY_STORE')) {
      return 'TEST_NO_OP';
    }
    throw new WebhookProcessingError('invalid_test_event', 'QUARANTINED');
  }
  if (eventEnvironment !== expectedEnvironment) {
    throw new WebhookProcessingError('environment_mismatch', 'QUARANTINED');
  }
  if (store !== 'PLAY_STORE' && store !== 'GOOGLE_PLAY') {
    throw new WebhookProcessingError('unsupported_store', 'QUARANTINED');
  }
  return 'GOOGLE_RECONCILIATION';
}

async function processWebhookEvent(
  job: ClaimedWebhookEvent,
  workerId: string,
  dependencies: {
    client?: PrismaClient;
    resolveIdentity?: typeof resolveWebhookBillingAccount;
    reconcile?: (billingAccountId: string) => Promise<BillingReconciliationResult>;
    reconcilePeriodic?: typeof reconcilePeriodicCandidateNow;
  } = {},
): Promise<void> {
  const client = dependencies.client ?? prisma;
  const resolveIdentity = dependencies.resolveIdentity ?? resolveWebhookBillingAccount;
  const reconcile = dependencies.reconcile ?? reconcileRevenueCatGoogleLedger;
  const reconcilePeriodic = dependencies.reconcilePeriodic ?? reconcilePeriodicCandidateNow;
  const heartbeat = startLeaseHeartbeat(job.id, workerId, client);
  try {
    const payload = parseRedactedRevenueCatWebhookPayload(job.payloadRedacted);
    const scope = assertEventScope(payload);
    if (scope === 'TEST_NO_OP') {
      if (!await heartbeat.stop()) throw new WebhookLeaseLostError();
      await completeWebhookEvent(job.id, workerId, client);
      logger.info({
        event: 'billing.webhook_processed',
        mode: 'test_no_op',
        attempts: job.attempts,
        issues: [],
      }, 'RevenueCat test webhook processed as no-op');
      return;
    }
    const billingAccountId = await resolveIdentity(payload, client);
    const periodicResult = await reconcilePeriodic(
      billingAccountId,
      `webhook-${workerId}`,
      client,
      reconcile,
    );
    if (periodicResult.kind === 'BUSY') {
      const retryAfterMs = periodicResult.nextDueAt
        ? Math.max(0, periodicResult.nextDueAt.getTime() - Date.now())
        : undefined;
      throw new WebhookProcessingError('account_reconciliation_in_progress', 'RETRY', retryAfterMs);
    }
    if (periodicResult.kind === 'LEASE_LOST') {
      throw new WebhookProcessingError('account_reconciliation_in_progress', 'RETRY');
    }
    if (periodicResult.kind === 'BLOCKING') {
      throw new WebhookProcessingError(
        'blocking_provider_evidence',
        'QUARANTINED',
        Math.max(0, periodicResult.nextDueAt.getTime() - Date.now()),
      );
    }
    if (periodicResult.kind === 'FAILED') {
      const errorCode = periodicResult.errorCode.toLowerCase();
      const ownershipConflict = [
        'billing_ownership_conflict',
        'billing_chain_conflict',
        'billing_transaction_conflict',
        'billing_canonical_identity_invalid',
      ].includes(errorCode);
      throw new WebhookProcessingError(
        errorCode,
        ownershipConflict ? 'QUARANTINED' : periodicResult.providerRetryable === false ? 'DEAD_LETTER' : 'RETRY',
        Math.max(0, periodicResult.nextDueAt.getTime() - Date.now()),
      );
    }
    const result = periodicResult.result;
    if (!await heartbeat.stop()) throw new WebhookLeaseLostError();
    await completeWebhookEvent(job.id, workerId, client);
    logger.info({
      event: 'billing.webhook_processed',
      attempts: job.attempts,
      issues: result.issues.map(({ code, severity, count }) => ({ code, severity, count })),
    }, 'Billing webhook processed');
  } catch (cause) {
    await heartbeat.stop();
    let disposition: RetryKind = 'RETRY';
    let errorCode = 'internal_error';
    let retryAfterMs: number | undefined;
    if (cause instanceof WebhookLeaseLostError) {
      logger.warn({ event: 'billing.webhook_lease_lost', attempts: job.attempts });
      return;
    } else if (cause instanceof BillingWebhookIdentityError) {
      disposition = 'QUARANTINED';
      errorCode = cause.code.toLowerCase();
    } else if (cause instanceof WebhookProcessingError) {
      disposition = cause.disposition;
      errorCode = cause.code;
      retryAfterMs = cause.retryAfterMs;
    } else if (cause instanceof RevenueCatProviderError) {
      disposition = cause.retryable ? 'RETRY' : 'DEAD_LETTER';
      errorCode = cause.code;
      retryAfterMs = cause.retryAfterMs;
    } else if (cause instanceof AppError && [
      'BILLING_OWNERSHIP_CONFLICT',
      'BILLING_CHAIN_CONFLICT',
      'BILLING_TRANSACTION_CONFLICT',
    ].includes(cause.code ?? '')) {
      disposition = 'QUARANTINED';
      errorCode = (cause.code ?? 'billing_evidence_conflict').toLowerCase();
    } else if (cause instanceof TypeError && cause.message === 'invalid_redacted_webhook_payload') {
      disposition = 'DEAD_LETTER';
      errorCode = 'invalid_redacted_payload';
    } else {
      Sentry.captureMessage('Billing webhook processing failed unexpectedly', {
        level: 'error',
        tags: { worker: 'billing-webhook', operation: 'process_job', errorCode: 'internal_error' },
      });
    }
    try {
      await deferWebhookEvent(job, workerId, disposition, errorCode, retryAfterMs, client);
    } catch {
      Sentry.captureMessage('Billing webhook failure could not be persisted', {
        level: 'error',
        tags: { worker: 'billing-webhook', operation: 'persist_failure', errorCode: 'database_error' },
      });
    }
  }
}

async function nextWebhookDueAt(client: PrismaClient = prisma): Promise<Date | null> {
  const [row] = await client.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    return tx.$queryRaw<Array<{ nextDueAt: Date | null }>>`
      SELECT MIN(due_at) AS "nextDueAt" FROM (
        SELECT "nextAttemptAt" AS due_at FROM billing_webhook_events
        WHERE status IN ('PENDING', 'RETRY', 'QUARANTINED') AND attempts < ${MAX_ATTEMPTS}
          AND NOT (status = 'QUARANTINED'
            AND COALESCE("quarantineStartedAt", "receivedAt") <= NOW() - INTERVAL '7 days')
        UNION ALL
        SELECT "leaseUntil" AS due_at FROM billing_webhook_events WHERE status = 'PROCESSING'
      ) due
    `;
  });
  return row?.nextDueAt ? new Date(row.nextDueAt) : null;
}

export async function getBillingWebhookMetrics(client: PrismaClient = prisma): Promise<{
  counts: Partial<Record<BillingWebhookEventStatus, number>>;
  oldestActionableAgeMs: number | null;
}> {
  const [groups, oldest] = await Promise.all([
    client.billingWebhookEvent.groupBy({ by: ['status'], _count: { _all: true } }),
    client.billingWebhookEvent.findFirst({
      where: { status: { in: ['PENDING', 'RETRY', 'QUARANTINED', 'PROCESSING'] } },
      orderBy: { receivedAt: 'asc' },
      select: { receivedAt: true },
    }),
  ]);
  return {
    counts: Object.fromEntries(groups.map(({ status, _count }) => [status, _count._all])),
    oldestActionableAgeMs: oldest ? Math.max(0, Date.now() - oldest.receivedAt.getTime()) : null,
  };
}

export async function processWebhookEvents(take = 20): Promise<BatchResult> {
  if (!env.BILLING_REVENUECAT_ENABLED) return { processedCount: 0, nextDueAt: null };
  await terminalizeExhaustedEvents();
  const workerId = randomUUID();
  let processedCount = 0;
  for (; processedCount < take; processedCount += 1) {
    const [job] = await claimWebhookEvents(workerId, 1);
    if (!job) break;
    await processWebhookEvent(job, workerId);
  }
  if (processedCount > 0) {
    const metrics = await getBillingWebhookMetrics();
    logger.info({ event: 'billing.webhook_batch_completed', processedCount, ...metrics });
  }
  return { processedCount, nextDueAt: await nextWebhookDueAt() };
}

async function nextRetentionDueAt(client: PrismaClient = prisma): Promise<Date | null> {
  const days = env.BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS;
  const [row] = await client.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    return tx.$queryRaw<Array<{ nextDueAt: Date | null }>>`
      SELECT MIN("processedAt" + (${days} * INTERVAL '1 day')) AS "nextDueAt"
      FROM billing_webhook_events
      WHERE status = 'PROCESSED' AND "payloadRedacted" IS NOT NULL
    `;
  });
  return row?.nextDueAt ? new Date(row.nextDueAt) : null;
}

export async function purgeProcessedWebhookPayloads(take = 100): Promise<BatchResult> {
  const days = env.BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS;
  const purged = await prisma.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    const events = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM billing_webhook_events
      WHERE status = 'PROCESSED' AND "payloadRedacted" IS NOT NULL
        AND "processedAt" <= NOW() - (${days} * INTERVAL '1 day')
      ORDER BY "processedAt", id
      FOR UPDATE SKIP LOCKED
      LIMIT ${take}
    `;
    if (events.length === 0) return 0;
    const ids = events.map(({ id }) => id);
    const observations = await tx.billingWebhookObservation.updateMany({
      where: { billingWebhookEventId: { in: ids }, payloadRedacted: { not: Prisma.DbNull } },
      data: { payloadRedacted: Prisma.DbNull, payloadPurgedAt: new Date() },
    });
    const result = await tx.billingWebhookEvent.updateMany({
      where: { id: { in: ids }, status: 'PROCESSED', payloadRedacted: { not: Prisma.DbNull } },
      data: { payloadRedacted: Prisma.DbNull, payloadPurgedAt: new Date() },
    });
    return result.count + observations.count;
  });
  return { processedCount: purged, nextDueAt: await nextRetentionDueAt() };
}

export const webhookWorkerInternals = {
  MAX_ATTEMPTS,
  QUARANTINE_MAX_AGE_DAYS,
  retryDate,
  claimWebhookEvents,
  terminalizeExhaustedEvents,
  processWebhookEvent,
  nextWebhookDueAt,
  nextRetentionDueAt,
  assertEventScope,
  startLeaseHeartbeat,
};
