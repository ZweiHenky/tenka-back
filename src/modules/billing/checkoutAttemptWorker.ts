import { randomUUID } from 'node:crypto';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { Sentry } from '../../instrument';
import type { BillingCheckoutAttemptPurpose, BillingCheckoutAttemptStatus, PrismaClient } from '../../generated/prisma/client';
import { configureRawQuerySchema } from '../../utils/rawDatabaseSchema';
import type { BatchResult } from '../../workers/dueProcessor';
import { assertCanonicalBillingIdentity } from './canonicalIdentity';
import { reconcilePeriodicCandidateNow } from './periodicReconciliationWorker';
import { acquireBillingAccountLock } from './service';

const LEASE_SECONDS = 300;
const RETRY_MINUTES = 5;

interface ClaimedAttempt {
  id: string;
  billingAccountId: string;
  purchaseSelectionId: string | null;
  changeOperationId: string | null;
  purpose: BillingCheckoutAttemptPurpose;
  status: BillingCheckoutAttemptStatus;
  startedAt: Date;
  lastVerificationAt: Date;
  lastErrorCode: string | null;
}

async function claimAttempt(workerId: string, client: PrismaClient): Promise<ClaimedAttempt | null> {
  return client.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    const [attempt] = await tx.$queryRaw<ClaimedAttempt[]>`
      WITH due AS (
        SELECT "id"
        FROM billing_checkout_attempts
        WHERE "status" NOT IN ('VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED')
          AND "nextVerificationAt" IS NOT NULL
          AND "nextVerificationAt" <= NOW()
          AND ("leaseUntil" IS NULL OR "leaseUntil" <= NOW())
        ORDER BY "nextVerificationAt", "id"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE billing_checkout_attempts attempt
      SET "leaseUntil" = NOW() + (${LEASE_SECONDS} * INTERVAL '1 second'),
          "lockedBy" = ${workerId}, "lastVerificationAt" = NOW(),
          "verificationAttempts" = "verificationAttempts" + 1,
          "version" = "version" + 1, "updatedAt" = NOW()
      FROM due
      WHERE attempt."id" = due."id"
       RETURNING attempt."id", attempt."billingAccountId", attempt."purchaseSelectionId",
         attempt."changeOperationId", attempt."purpose",
        attempt."status", attempt."startedAt", attempt."lastVerificationAt", attempt."lastErrorCode"
    `;
    if (attempt) {
      await tx.billingVerification.updateMany({
        where: { checkoutAttemptId: attempt.id, status: 'PENDING' },
        data: { lastAttemptAt: attempt.lastVerificationAt, attemptCount: { increment: 1 }, lastErrorCode: null },
      });
    }
    return attempt ?? null;
  });
}

async function rescheduleAttempt(
  attempt: ClaimedAttempt,
  workerId: string,
  errorCode: string | null,
  client: PrismaClient,
): Promise<void> {
  await client.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    await tx.$executeRaw`
      UPDATE billing_checkout_attempts
      SET "nextVerificationAt" = NOW() + (${RETRY_MINUTES} * INTERVAL '1 minute'),
          "leaseUntil" = NULL, "lockedBy" = NULL, "lastErrorCode" = ${errorCode},
          "version" = "version" + 1, "updatedAt" = NOW()
      WHERE "id" = ${attempt.id} AND "lockedBy" = ${workerId}
        AND "status" NOT IN ('VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED')
    `;
    await tx.billingVerification.updateMany({
      where: { checkoutAttemptId: attempt.id, status: 'PENDING' },
      data: { lastErrorCode: errorCode },
    });
  });
}

async function closeAttemptWithoutEvidence(
  attempt: ClaimedAttempt,
  workerId: string,
  expectedStatus: 'CANCEL_REPORTED' | 'PREPARED',
  terminalStatus: 'CANCELED' | 'ABANDONED',
  client: PrismaClient,
): Promise<boolean> {
  return client.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    await acquireBillingAccountLock(tx, attempt.billingAccountId);
    const current = await tx.billingCheckoutAttempt.findUnique({
      where: { id: attempt.id },
      select: {
        id: true, status: true, version: true, lockedBy: true,
        logicalProductIdSnapshot: true, billingIntervalSnapshot: true,
        targetCapacitySnapshot: true, storeProductIdSnapshot: true, basePlanIdSnapshot: true,
      },
    });
    if (!current || current.status !== expectedStatus || current.lockedBy !== workerId) return false;
    const storeEnvironment = env.APP_ENV === 'production' ? 'PRODUCTION' : 'SANDBOX';
    const exactProduct = {
      logicalProductId: current.logicalProductIdSnapshot,
      storeProductId: current.storeProductIdSnapshot,
      basePlanId: current.basePlanIdSnapshot,
      billingInterval: current.billingIntervalSnapshot,
      capacity: current.targetCapacitySnapshot,
    };
    const evidence = await tx.billingProviderSubscription.findFirst({
      where: {
        chain: { billingAccountId: attempt.billingAccountId, store: 'GOOGLE' },
        storeEnvironment,
        OR: [
          {
            currentLogicalProductId: current.logicalProductIdSnapshot,
            currentBillingInterval: current.billingIntervalSnapshot,
            currentCapacity: current.targetCapacitySnapshot,
            currentStoreProductId: current.storeProductIdSnapshot,
            currentBasePlanId: current.basePlanIdSnapshot,
          },
          {
            pendingLogicalProductId: current.logicalProductIdSnapshot,
            pendingBillingInterval: current.billingIntervalSnapshot,
            pendingCapacity: current.targetCapacitySnapshot,
            pendingStoreProductId: current.storeProductIdSnapshot,
            pendingBasePlanId: current.basePlanIdSnapshot,
          },
        ],
        providerStatus: { in: ['ACTIVE', 'BILLING_RETRY', 'STORE_GRACE', 'ACCOUNT_HOLD', 'PAUSED'] },
      },
      select: { id: true },
    });
    if (evidence) return false;
    const [transactionEvidence, providerPeriodEvidence, historicalEvidence] = await Promise.all([
      tx.billingTransaction.findFirst({
        where: {
          billingAccountId: attempt.billingAccountId, store: 'GOOGLE', storeEnvironment,
          ...exactProduct, purchasedAt: { gte: attempt.startedAt },
        },
        select: { id: true },
      }),
      tx.billingProviderPeriod.findFirst({
        where: {
          billingAccountId: attempt.billingAccountId, store: 'GOOGLE', storeEnvironment,
          ...exactProduct, providerPeriodStart: { gte: attempt.startedAt },
        },
        select: { id: true },
      }),
      tx.billingPeriod.findFirst({
        where: {
          billingAccountId: attempt.billingAccountId, source: 'STORE',
          logicalProductIdSnapshot: current.logicalProductIdSnapshot,
          billingIntervalAtStart: current.billingIntervalSnapshot,
          capacityAtStart: current.targetCapacitySnapshot,
          effectiveStart: { gte: attempt.startedAt },
          primaryProviderPeriod: {
            store: 'GOOGLE', storeEnvironment, storeProductId: current.storeProductIdSnapshot,
            basePlanId: current.basePlanIdSnapshot,
            transaction: { is: { purchasedAt: { gte: attempt.startedAt } } },
          },
        },
        select: { id: true },
      }),
    ]);
    if (transactionEvidence || providerPeriodEvidence || historicalEvidence) return false;
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
    let selectionVersion: number | null = null;
    if (attempt.purpose === 'INITIAL_PURCHASE') {
      if (!attempt.purchaseSelectionId) return false;
      const selection = await tx.billingPurchaseSelection.findUnique({
        where: { id: attempt.purchaseSelectionId }, select: { version: true, status: true, checkoutAttemptId: true },
      });
      if (!selection || selection.status !== 'LOCKED' || selection.checkoutAttemptId !== attempt.id) return false;
      await tx.billingPurchaseSelection.update({
        where: { id: attempt.purchaseSelectionId },
        data: { status: 'DRAFT', lockedAt: null, checkoutAttemptId: null, version: { increment: 1 } },
      });
      selectionVersion = selection.version + 1;
    } else if (attempt.purpose === 'PRODUCT_CHANGE_FIRST_STEP' && attempt.changeOperationId) {
      await tx.billingChangeOperation.updateMany({
        where: {
          id: attempt.changeOperationId, billingAccountId: attempt.billingAccountId,
          status: { in: ['FIRST_PURCHASE_PENDING', 'FIRST_VERIFICATION_PENDING'] },
        },
        data: { status: 'CANCELED', lastErrorCode: 'checkout_canceled_no_evidence', version: { increment: 1 } },
      });
    }
    await tx.billingCheckoutAttempt.update({
      where: { id: attempt.id },
      data: {
        status: terminalStatus, terminalAt: now, nextVerificationAt: null,
        leaseUntil: null, lockedBy: null, lastErrorCode: null, version: { increment: 1 },
      },
    });
    await tx.billingAuditLog.create({
      data: {
        action: 'BILLING_CHECKOUT_ATTEMPT_COMPLETED', actorType: 'SYSTEM',
        actorUserIdSnapshot: 'billing-checkout-worker', targetType: 'BillingCheckoutAttempt',
        targetId: attempt.id, requestId: randomUUID(),
         metadataRedacted: {
           resultingStatus: terminalStatus, selectionVersion,
           ...(attempt.purpose === 'INITIAL_PURCHASE' ? {} : { purpose: attempt.purpose }),
         },
      },
    });
    return true;
  }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 30_000 });
}

function confirmCancellation(attempt: ClaimedAttempt, workerId: string, client: PrismaClient) {
  return closeAttemptWithoutEvidence(attempt, workerId, 'CANCEL_REPORTED', 'CANCELED', client);
}

function abandonPreparedAttempt(attempt: ClaimedAttempt, workerId: string, client: PrismaClient) {
  return closeAttemptWithoutEvidence(attempt, workerId, 'PREPARED', 'ABANDONED', client);
}

async function closeCanonicalOwnershipConflict(
  attempt: ClaimedAttempt,
  workerId: string,
  client: PrismaClient,
): Promise<boolean> {
  if (attempt.lastErrorCode !== 'sdk_ownership_conflict') return false;
  return client.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    await acquireBillingAccountLock(tx, attempt.billingAccountId);
    const current = await tx.billingCheckoutAttempt.findUnique({
      where: { id: attempt.id },
      select: { status: true, lockedBy: true, lastErrorCode: true, version: true },
    });
    if (!current || current.lockedBy !== workerId || current.lastErrorCode !== 'sdk_ownership_conflict'
      || ['VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED'].includes(current.status)) {
      return false;
    }
    const selection = attempt.purpose === 'INITIAL_PURCHASE' && attempt.purchaseSelectionId
      ? await tx.billingPurchaseSelection.findUnique({
        where: { id: attempt.purchaseSelectionId },
        select: { status: true, checkoutAttemptId: true, version: true },
      }) : null;
    if (attempt.purpose === 'INITIAL_PURCHASE'
      && (!selection || selection.status !== 'LOCKED' || selection.checkoutAttemptId !== attempt.id)) return false;
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
    if (selection && attempt.purchaseSelectionId) {
      await tx.billingPurchaseSelection.update({
        where: { id: attempt.purchaseSelectionId },
        data: { status: 'DRAFT', lockedAt: null, checkoutAttemptId: null, version: { increment: 1 } },
      });
    }
    if (attempt.purpose === 'PRODUCT_CHANGE_FIRST_STEP' && attempt.changeOperationId) {
      await tx.billingChangeOperation.updateMany({
        where: { id: attempt.changeOperationId, status: { in: ['FIRST_PURCHASE_PENDING', 'FIRST_VERIFICATION_PENDING'] } },
        data: { status: 'CANCELED', lastErrorCode: 'canonical_unsafe_ownership', version: { increment: 1 } },
      });
    } else if (attempt.purpose === 'PRODUCT_CHANGE_FINAL_STEP' && attempt.changeOperationId) {
      await tx.billingChangeOperation.updateMany({
        where: { id: attempt.changeOperationId, status: 'SECOND_STEP_PENDING' },
        data: { lastErrorCode: 'canonical_unsafe_ownership', version: { increment: 1 } },
      });
    }
    const verificationRecord = await tx.billingVerification.findUnique({
      where: { checkoutAttemptId: attempt.id },
      select: { id: true, status: true },
    });
    const verification = await tx.billingVerification.updateMany({
      where: { checkoutAttemptId: attempt.id, status: 'PENDING' },
      data: {
        status: 'OWNERSHIP_CONFLICT', verifiedAt: now,
        lastAttemptAt: now, lastErrorCode: 'canonical_unsafe_ownership',
      },
    });
    await tx.billingCheckoutAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'OWNERSHIP_CONFLICT', terminalAt: now, nextVerificationAt: null,
        leaseUntil: null, lockedBy: null, lastErrorCode: 'canonical_unsafe_ownership',
        version: { increment: 1 },
      },
    });
    await tx.billingAuditLog.create({
      data: {
        action: 'BILLING_CHECKOUT_ATTEMPT_COMPLETED', actorType: 'SYSTEM',
        actorUserIdSnapshot: 'billing-checkout-worker', targetType: 'BillingCheckoutAttempt',
        targetId: attempt.id, requestId: randomUUID(),
        metadataRedacted: {
          resultingStatus: 'OWNERSHIP_CONFLICT',
          resultingVersion: current.version + 1,
          selectionVersion: selection ? selection.version + 1 : null,
          purpose: attempt.purpose,
        },
      },
    });
    if (verification.count === 1) {
      await tx.billingAuditLog.create({
        data: {
          action: 'BILLING_VERIFICATION_COMPLETED', actorType: 'SYSTEM',
          actorUserIdSnapshot: 'billing-checkout-worker', targetType: 'BillingVerification',
          targetId: verificationRecord?.id ?? attempt.id, requestId: randomUUID(),
          metadataRedacted: { resultingStatus: 'OWNERSHIP_CONFLICT' },
        },
      });
    }
    return true;
  }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 30_000 });
}

async function nextDueAt(client: PrismaClient): Promise<Date | null> {
  const row = await client.billingCheckoutAttempt.findFirst({
    where: {
      status: { notIn: ['VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED'] },
      nextVerificationAt: { not: null },
    },
    orderBy: [{ nextVerificationAt: 'asc' }, { id: 'asc' }],
    select: { nextVerificationAt: true },
  });
  return row?.nextVerificationAt ?? null;
}

export async function processCheckoutAttempts(
  take = 5,
  client: PrismaClient = prisma,
): Promise<BatchResult> {
  const workerId = randomUUID();
  let processedCount = 0;
  for (; processedCount < take; processedCount += 1) {
    const attempt = await claimAttempt(workerId, client);
    if (!attempt) break;
    try {
      await assertCanonicalBillingIdentity(attempt.billingAccountId, client);
      const reconciliation = await reconcilePeriodicCandidateNow(
        attempt.billingAccountId,
        `checkout:${workerId}`,
        client,
      );
      const current = await client.billingCheckoutAttempt.findUnique({
        where: { id: attempt.id }, select: { status: true },
      });
      if (current?.status === 'VERIFIED') continue;
      const unresolvedForMs = Date.now() - attempt.startedAt.getTime();
      if (reconciliation.kind === 'BLOCKING'
        && reconciliation.result.issues.some(({ code }) => code === 'UNSAFE_OWNERSHIP')
        && await closeCanonicalOwnershipConflict(attempt, workerId, client)) continue;
      if (reconciliation.kind === 'SUCCESS' && attempt.status === 'CANCEL_REPORTED'
        && await confirmCancellation(attempt, workerId, client)) continue;
      if (reconciliation.kind === 'SUCCESS' && attempt.status === 'PREPARED'
        && unresolvedForMs >= 60 * 60_000
        && await abandonPreparedAttempt(attempt, workerId, client)) continue;
      await rescheduleAttempt(
        attempt,
        workerId,
        reconciliation.kind === 'SUCCESS' ? null : reconciliation.kind.toLowerCase(),
        client,
      );
      if (unresolvedForMs >= 60 * 60_000) {
        Sentry.captureMessage('Billing checkout verification remains unresolved', {
          level: 'warning', tags: { worker: 'billing-checkout', status: attempt.status },
        });
      }
    } catch (error) {
      await rescheduleAttempt(attempt, workerId, 'verification_failed', client);
      logger.warn({
        event: 'billing.checkout_verification_deferred',
        status: attempt.status,
        causeType: error instanceof Error ? error.name : typeof error,
      }, 'Billing checkout verification deferred');
    }
  }
  return { processedCount, nextDueAt: await nextDueAt(client) };
}

export const checkoutAttemptWorkerInternals = {
  claimAttempt, confirmCancellation, abandonPreparedAttempt, closeCanonicalOwnershipConflict, nextDueAt,
};
