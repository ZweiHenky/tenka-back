import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client';
import { AppError } from '../../utils/errors';
import { RevenueCatProviderError } from './revenueCatClient';
import { BillingWebhookIdentityError } from './webhookIdentity';
import { webhookWorkerInternals } from './webhookWorker';

const payload = {
  apiVersion: '1.0',
  event: {
    id: 'event-1',
    type: 'RENEWAL',
    appUserId: 'billing_primary',
    originalAppUserId: null,
    aliases: [],
    environment: 'SANDBOX',
    store: 'PLAY_STORE',
  },
};

function setup() {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const executeRaw = vi.fn().mockResolvedValue(1);
  const rawClient = { $queryRaw: vi.fn().mockResolvedValue([]), $executeRaw: executeRaw };
  const client = {
    billingWebhookEvent: { updateMany },
    $transaction: vi.fn((operation) => operation(rawClient)),
  } as unknown as PrismaClient;
  const job = {
    id: 'internal-event-id', payloadRedacted: payload, attempts: 1, receivedAt: new Date(),
    quarantineStartedAt: null,
  };
  return { client, job, updateMany, executeRaw };
}

function rawValues(executeRaw: ReturnType<typeof vi.fn>): unknown[] {
  return executeRaw.mock.calls.flatMap((call) => call.slice(1));
}

describe('billing webhook worker', () => {
  it('marks an event processed only after canonical reconciliation succeeds', async () => {
    const { client, job, updateMany } = setup();
    const resolveIdentity = vi.fn().mockResolvedValue('account-1');
    const reconciliationResult = {
      subscriptionsObserved: 1,
      subscriptionsPersisted: 1,
      transactionsCreated: 0,
      periodsCreated: 0,
      issues: [],
    };
    const reconcile = vi.fn().mockResolvedValue(reconciliationResult);
    const reconcilePeriodic = vi.fn().mockResolvedValue({
      kind: 'SUCCESS', result: reconciliationResult,
    });

    await webhookWorkerInternals.processWebhookEvent(job, 'worker-1', {
      client, resolveIdentity, reconcile, reconcilePeriodic,
    });

    expect(reconcilePeriodic).toHaveBeenCalledWith('account-1', 'webhook-worker-1', client, reconcile);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: job.id, status: 'PROCESSING', lockedBy: 'worker-1' },
      data: expect.objectContaining({ status: 'PROCESSED', lastError: null }),
    }));
  });

  it.each(['APP_STORE', 'PLAY_STORE'])('processes the official sandbox TEST event from %s as a no-op', async (store) => {
    const { client, job, updateMany } = setup();
    job.payloadRedacted = {
      ...payload,
      event: { ...payload.event, type: 'TEST', store },
    };
    const resolveIdentity = vi.fn();
    const reconcile = vi.fn();

    await webhookWorkerInternals.processWebhookEvent(job, 'worker-1', {
      client, resolveIdentity, reconcile,
    });

    expect(resolveIdentity).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PROCESSED', lastError: null }),
    }));
  });

  it('quarantines TEST events outside the exact sandbox contract', () => {
    expect(() => webhookWorkerInternals.assertEventScope({
      ...payload,
      event: { ...payload.event, type: 'TEST', store: 'RC_BILLING' },
    })).toThrow('invalid_test_event');
    expect(() => webhookWorkerInternals.assertEventScope({
      ...payload,
      event: { ...payload.event, type: 'TEST', environment: 'PRODUCTION', store: 'APP_STORE' },
    })).toThrow('invalid_test_event');
    expect(() => webhookWorkerInternals.assertEventScope({
      ...payload,
      event: { ...payload.event, type: 'RENEWAL', store: 'APP_STORE' },
    })).toThrow('unsupported_store');
  });

  it('quarantines unresolved identities without consulting RevenueCat', async () => {
    const { client, job, executeRaw } = setup();
    const reconcile = vi.fn();
    await webhookWorkerInternals.processWebhookEvent(job, 'worker-1', {
      client,
      resolveIdentity: vi.fn().mockRejectedValue(new BillingWebhookIdentityError('IDENTITY_UNRESOLVED')),
      reconcile,
    });
    expect(reconcile).not.toHaveBeenCalled();
    expect(rawValues(executeRaw)).toEqual(expect.arrayContaining(['QUARANTINED', 'identity_unresolved']));
  });

  it('does not duplicate provider I/O while periodic reconciliation owns the account lease', async () => {
    const { client, job, executeRaw } = setup();
    const reconcile = vi.fn();
    await webhookWorkerInternals.processWebhookEvent(job, 'worker-1', {
      client,
      resolveIdentity: vi.fn().mockResolvedValue('account-1'),
      reconcilePeriodic: vi.fn().mockResolvedValue({ kind: 'BUSY', nextDueAt: null }),
      reconcile,
    });
    expect(reconcile).not.toHaveBeenCalled();
    expect(rawValues(executeRaw)).toEqual(expect.arrayContaining([
      'RETRY', 'account_reconciliation_in_progress',
    ]));
  });

  it('retries transient provider failures and dead-letters terminal failures', async () => {
    for (const [retryable, status] of [[true, 'RETRY'], [false, 'DEAD_LETTER']] as const) {
      const { client, job, executeRaw } = setup();
      await webhookWorkerInternals.processWebhookEvent(job, 'worker-1', {
        client,
        resolveIdentity: vi.fn().mockResolvedValue('account-1'),
        reconcile: vi.fn().mockRejectedValue(new RevenueCatProviderError('provider_failure', retryable)),
        reconcilePeriodic: vi.fn().mockResolvedValue({
          kind: 'FAILED',
          errorCode: 'provider_failure',
          providerRetryable: retryable,
          nextDueAt: new Date(Date.now() + 60_000),
        }),
      });
      expect(rawValues(executeRaw)).toEqual(expect.arrayContaining([status, 'provider_failure']));
    }
  });

  it('quarantines reconciliation with blocking evidence', async () => {
    const { client, job, executeRaw } = setup();
    await webhookWorkerInternals.processWebhookEvent(job, 'worker-1', {
      client,
      resolveIdentity: vi.fn().mockResolvedValue('account-1'),
      reconcilePeriodic: vi.fn().mockResolvedValue({
        kind: 'BLOCKING',
        nextDueAt: new Date(Date.now() + 60_000),
        result: {
          subscriptionsObserved: 1,
          subscriptionsPersisted: 0,
          transactionsCreated: 0,
          periodsCreated: 0,
          issues: [{ code: 'UNKNOWN_PRODUCT', severity: 'BLOCKING', count: 1 }],
        },
      }),
      reconcile: vi.fn().mockResolvedValue({
        subscriptionsObserved: 1,
        subscriptionsPersisted: 0,
        transactionsCreated: 0,
        periodsCreated: 0,
        issues: [{ code: 'UNKNOWN_PRODUCT', severity: 'BLOCKING', count: 1 }],
      }),
    });
    expect(rawValues(executeRaw)).toEqual(expect.arrayContaining(['QUARANTINED', 'blocking_provider_evidence']));
  });

  it('quarantines permanent ledger ownership conflicts', async () => {
    const { client, job, executeRaw } = setup();
    await webhookWorkerInternals.processWebhookEvent(job, 'worker-1', {
      client,
      resolveIdentity: vi.fn().mockResolvedValue('account-1'),
      reconcilePeriodic: vi.fn().mockResolvedValue({
        kind: 'FAILED',
        errorCode: 'BILLING_OWNERSHIP_CONFLICT',
        nextDueAt: new Date(Date.now() + 60_000),
      }),
      reconcile: vi.fn().mockRejectedValue(new AppError(
        409,
        'conflict',
        'BILLING_OWNERSHIP_CONFLICT',
      )),
    });
    expect(rawValues(executeRaw)).toEqual(expect.arrayContaining([
      'QUARANTINED', 'billing_ownership_conflict',
    ]));
  });

  it('renews a live processing lease and detects lost ownership', async () => {
    vi.useFakeTimers();
    const executeRaw = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const rawClient = { $queryRaw: vi.fn().mockResolvedValue([]), $executeRaw: executeRaw };
    const client = {
      $transaction: vi.fn((operation) => operation(rawClient)),
    } as unknown as PrismaClient;
    try {
      const first = webhookWorkerInternals.startLeaseHeartbeat('event-1', 'worker-1', client, 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(executeRaw).toHaveBeenCalledTimes(1);
      await expect(first.stop()).resolves.toBe(true);
      expect(rawValues(executeRaw)).toEqual(expect.arrayContaining(['event-1', 'worker-1']));

      const second = webhookWorkerInternals.startLeaseHeartbeat('event-1', 'worker-2', client, 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(executeRaw).toHaveBeenCalledTimes(2);
      await expect(second.stop()).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
