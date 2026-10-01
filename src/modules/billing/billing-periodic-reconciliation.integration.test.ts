import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { prisma } from '../../config/database';
import { configureRawQuerySchema } from '../../utils/rawDatabaseSchema';
import { ensureBillingAccount } from './service';
import {
  periodicReconciliationInternals,
  reconcilePeriodicCandidateNow,
  schedulePeriodicReconciliationCandidate,
} from './periodicReconciliationWorker';

async function createBillingAccount() {
  const userId = `it-periodic-user-${randomUUID()}`;
  await prisma.user.create({
    data: { id: userId, email: `${userId}@example.test`, rol: 'LIGA' },
  });
  return prisma.$transaction((tx) => ensureBillingAccount(tx, userId));
}

async function makeDue(billingAccountId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    await tx.$executeRaw`
      UPDATE billing_revenuecat_reconciliations
      SET status = 'SCHEDULED', "nextAttemptAt" = NOW() - INTERVAL '1 minute',
          "leaseUntil" = NULL, "lockedBy" = NULL, "updatedAt" = NOW()
      WHERE "billingAccountId" = ${billingAccountId}
    `;
  });
}

describe('periodic RevenueCat reconciliation database invariants', () => {
  test('keeps ordinary free accounts out of the sparse queue', async () => {
    const account = await createBillingAccount();
    await expect(prisma.billingRevenueCatReconciliation.findUnique({
      where: { billingAccountId: account.id },
    })).resolves.toBeNull();
  });

  test('claims explicit candidates once and recovers only expired leases', async () => {
    const first = await createBillingAccount();
    const second = await createBillingAccount();
    await expect(schedulePeriodicReconciliationCandidate(first.id, 60)).resolves.toBe(false);
    await expect(schedulePeriodicReconciliationCandidate(second.id, 60)).resolves.toBe(false);
    await makeDue(first.id);
    await makeDue(second.id);

    const [firstClaim, secondClaim] = await Promise.all([
      periodicReconciliationInternals.claimReconciliations('periodic-worker-a', 1),
      periodicReconciliationInternals.claimReconciliations('periodic-worker-b', 1),
    ]);
    expect(firstClaim).toHaveLength(1);
    expect(secondClaim).toHaveLength(1);
    expect(firstClaim[0].billingAccountId).not.toBe(secondClaim[0].billingAccountId);
    await expect(periodicReconciliationInternals.claimReconciliations('periodic-worker-c', 2))
      .resolves.toEqual([]);

    await prisma.$transaction(async (tx) => {
      await configureRawQuerySchema(tx);
      await tx.$executeRaw`
        UPDATE billing_revenuecat_reconciliations
        SET "leaseUntil" = NOW() - INTERVAL '1 minute'
        WHERE "billingAccountId" = ${firstClaim[0].billingAccountId}
      `;
    });
    const recovered = await periodicReconciliationInternals.claimReconciliations('periodic-worker-d', 1);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].billingAccountId).toBe(firstClaim[0].billingAccountId);
  }, 20_000);

  test('completes idempotently and database constraints reject invalid lease state', async () => {
    const account = await createBillingAccount();
    await schedulePeriodicReconciliationCandidate(account.id, 60);
    await makeDue(account.id);
    const [job] = await periodicReconciliationInternals.claimReconciliations('periodic-worker', 1);
    expect(job.billingAccountId).toBe(account.id);
    await expect(schedulePeriodicReconciliationCandidate(account.id, 360)).resolves.toBe(true);

    await periodicReconciliationInternals.processReconciliation(job, 'periodic-worker', {
      assertIdentity: async () => undefined,
      reconcile: async () => ({
        subscriptionsObserved: 1,
        subscriptionsPersisted: 1,
        transactionsCreated: 0,
        periodsCreated: 0,
        issues: [],
      }),
      criticalState: async () => false,
    });
    await expect(prisma.billingRevenueCatReconciliation.findUniqueOrThrow({
      where: { billingAccountId: account.id },
    })).resolves.toMatchObject({
      status: 'SCHEDULED',
      consecutiveFailures: 0,
      lastSucceededAt: expect.any(Date),
      requestedNextAttemptAt: null,
      leaseUntil: null,
      lockedBy: null,
    });
    const [timing] = await prisma.$transaction(async (tx) => {
      await configureRawQuerySchema(tx);
      return tx.$queryRaw<Array<{ minutesUntilDue: number }>>`
        SELECT EXTRACT(EPOCH FROM ("nextAttemptAt" - NOW())) / 60 AS "minutesUntilDue"
        FROM billing_revenuecat_reconciliations
        WHERE "billingAccountId" = ${account.id}
      `;
    });
    expect(Number(timing.minutesUntilDue)).toBeGreaterThan(350);
    expect(Number(timing.minutesUntilDue)).toBeLessThanOrEqual(360);

    await expect(prisma.billingRevenueCatReconciliation.update({
      where: { billingAccountId: account.id },
      data: { status: 'PROCESSING' },
    })).rejects.toThrow();
  }, 20_000);

  test('uses one shared account lease for concurrent provider reconciliation', async () => {
    const account = await createBillingAccount();
    let releaseProvider!: () => void;
    let markStarted!: () => void;
    const providerStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const providerRelease = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const reconcile = async () => {
      markStarted();
      await providerRelease;
      return {
        subscriptionsObserved: 1,
        subscriptionsPersisted: 1,
        transactionsCreated: 0,
        periodsCreated: 0,
        issues: [],
      };
    };

    const first = reconcilePeriodicCandidateNow(account.id, 'event-worker-a', prisma, reconcile);
    await providerStarted;
    await expect(reconcilePeriodicCandidateNow(account.id, 'event-worker-b', prisma, reconcile))
      .resolves.toMatchObject({ kind: 'BUSY', nextDueAt: expect.any(Date) });
    releaseProvider();
    await expect(first).resolves.toMatchObject({ kind: 'SUCCESS' });
  }, 20_000);

  test('does not let an event-driven retry bypass the account backoff', async () => {
    const account = await createBillingAccount();
    await schedulePeriodicReconciliationCandidate(account.id, 60);
    await prisma.$transaction(async (tx) => {
      await configureRawQuerySchema(tx);
      await tx.$executeRaw`
        UPDATE billing_revenuecat_reconciliations
        SET status = 'RETRY', "nextAttemptAt" = NOW() + INTERVAL '6 hours', "updatedAt" = NOW()
        WHERE "billingAccountId" = ${account.id}
      `;
    });
    let providerCalls = 0;
    const result = await reconcilePeriodicCandidateNow(account.id, 'event-worker', prisma, async () => {
      providerCalls += 1;
      throw new Error('provider must not be called');
    });
    expect(result).toMatchObject({ kind: 'BUSY', nextDueAt: expect.any(Date) });
    expect(providerCalls).toBe(0);
  }, 20_000);
});
