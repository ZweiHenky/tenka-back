import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env';
import type { PrismaClient } from '../../generated/prisma/client';
import { AppError } from '../../utils/errors';
import {
  periodicReconciliationInternals,
  processPeriodicReconciliations,
  schedulePeriodicReconciliationCandidate,
} from './periodicReconciliationWorker';

function setupClient() {
  const executeRaw = vi.fn().mockResolvedValue(1);
  const queryRaw = vi.fn().mockImplementation((strings: TemplateStringsArray) =>
    strings.join('').includes('RETURNING "nextAttemptAt"')
      ? [{ nextAttemptAt: new Date(Date.now() + 60_000) }]
      : []);
  const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw };
  const client = {
    $transaction: vi.fn((operation) => operation(tx)),
    billingProviderSubscription: { findFirst: vi.fn().mockResolvedValue(null) },
    billingRevenueCatReconciliation: { groupBy: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaClient;
  return { client, executeRaw, queryRaw };
}

function rawValues(mock: ReturnType<typeof vi.fn>): unknown[] {
  return mock.mock.calls.flatMap((call) => call.slice(1));
}

const originalRevenueCatEnabled = env.BILLING_REVENUECAT_ENABLED;
const originalPeriodicEnabled = env.BILLING_PERIODIC_RECONCILIATION_ENABLED;

afterEach(() => {
  env.BILLING_REVENUECAT_ENABLED = originalRevenueCatEnabled;
  env.BILLING_PERIODIC_RECONCILIATION_ENABLED = originalPeriodicEnabled;
  vi.restoreAllMocks();
});

describe('periodic RevenueCat reconciliation worker', () => {
  it('does no work while the cost-control flag is disabled', async () => {
    env.BILLING_REVENUECAT_ENABLED = true;
    env.BILLING_PERIODIC_RECONCILIATION_ENABLED = false;
    await expect(processPeriodicReconciliations()).resolves.toEqual({
      processedCount: 0,
      nextDueAt: null,
    });
  });

  it('schedules only an explicit commercial candidate', async () => {
    const { client, queryRaw } = setupClient();
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ processing: false }]);
    await schedulePeriodicReconciliationCandidate('billing_account-1', 1440, client);
    expect(rawValues(queryRaw)).toEqual(expect.arrayContaining(['billing_account-1', 1440]));
  });

  it('completes a clean reconciliation on the low-cost daily cadence', async () => {
    const { client, executeRaw } = setupClient();
    const reconcile = vi.fn().mockResolvedValue({
      subscriptionsObserved: 1,
      subscriptionsPersisted: 1,
      transactionsCreated: 0,
      periodsCreated: 0,
      issues: [],
    });
    await periodicReconciliationInternals.processReconciliation(
      { billingAccountId: 'billing_account-1', consecutiveFailures: 2 },
      'worker-1',
      {
        client,
        assertIdentity: vi.fn().mockResolvedValue(undefined),
        reconcile,
        criticalState: vi.fn().mockResolvedValue(false),
      },
    );
    expect(reconcile).toHaveBeenCalledWith('billing_account-1');
    expect(rawValues(executeRaw)).toEqual(expect.arrayContaining([
      env.BILLING_RECONCILIATION_ACTIVE_INTERVAL_MINUTES,
      'billing_account-1',
      'worker-1',
    ]));
  });

  it('keeps blocking evidence on the six-hour discrepancy cadence', async () => {
    const { client, queryRaw } = setupClient();
    const issues = [{ code: 'UNKNOWN_PRODUCT', severity: 'BLOCKING', count: 1 }] as const;
    await periodicReconciliationInternals.processReconciliation(
      { billingAccountId: 'billing_account-1', consecutiveFailures: 0 },
      'worker-1',
      {
        client,
        assertIdentity: vi.fn().mockResolvedValue(undefined),
        reconcile: vi.fn().mockResolvedValue({
          subscriptionsObserved: 1,
          subscriptionsPersisted: 0,
          transactionsCreated: 0,
          periodsCreated: 0,
          issues,
        }),
        criticalState: vi.fn(),
      },
    );
    expect(rawValues(queryRaw)).toEqual(expect.arrayContaining([
      env.BILLING_RECONCILIATION_CRITICAL_INTERVAL_MINUTES * 60_000,
      'blocking_provider_evidence',
      JSON.stringify(issues),
    ]));
  });

  it('does not call RevenueCat for an invalid canonical identity', async () => {
    const { client, queryRaw } = setupClient();
    const reconcile = vi.fn();
    await periodicReconciliationInternals.processReconciliation(
      { billingAccountId: 'billing_account-1', consecutiveFailures: 0 },
      'worker-1',
      {
        client,
        assertIdentity: vi.fn().mockRejectedValue(new AppError(
          409,
          'invalid identity',
          'BILLING_CANONICAL_IDENTITY_INVALID',
        )),
        reconcile,
      },
    );
    expect(reconcile).not.toHaveBeenCalled();
    expect(rawValues(queryRaw)).toEqual(expect.arrayContaining([
      'BILLING_CANONICAL_IDENTITY_INVALID',
      env.BILLING_RECONCILIATION_CRITICAL_INTERVAL_MINUTES * 60_000,
    ]));
  });

  it('caps exponential retries while honoring a larger Retry-After', () => {
    expect(periodicReconciliationInternals.retryDelayMs(0, undefined, () => 0)).toBe(60_000);
    expect(periodicReconciliationInternals.retryDelayMs(20, undefined, () => 0)).toBe(21_600_000);
    expect(periodicReconciliationInternals.retryDelayMs(20, undefined, () => 1)).toBe(21_600_000);
    expect(periodicReconciliationInternals.retryDelayMs(0, 30_000_000, () => 0)).toBe(21_600_000);
  });
});
