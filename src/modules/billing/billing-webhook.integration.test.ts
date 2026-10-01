import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import {
  getAdminBillingWebhookEvent,
  listAdminBillingWebhookEvents,
  replayAdminBillingWebhookEvent,
} from './adminWebhookService';
import { ingestRevenueCatWebhook, parseRevenueCatWebhook } from './webhookInbox';
import { purgeProcessedWebhookPayloads, webhookWorkerInternals } from './webhookWorker';

const prefix = 'it-billing-webhook-';

function input(providerEventId: string, type = 'INITIAL_PURCHASE') {
  return parseRevenueCatWebhook(Buffer.from(JSON.stringify({
    event: {
      id: providerEventId,
      type,
      app_user_id: 'billing_account-integration',
      environment: 'SANDBOX',
      store: 'PLAY_STORE',
      transaction_id: 'must-not-be-persisted',
    },
  })));
}

async function cleanup() {
  await prisma.billingWebhookEvent.updateMany({
    where: { providerEventId: { startsWith: prefix } },
    data: {
      status: 'CONFLICT',
      processedAt: null,
      leaseUntil: null,
      lockedBy: null,
    },
  });
}

describe('billing webhook inbox database invariants', () => {
  afterEach(cleanup);

  test('serializes concurrent duplicates and records conflicting evidence once', async () => {
    const providerEventId = `${prefix}${randomUUID()}`;
    const original = input(providerEventId);
    const results = await Promise.all([
      ingestRevenueCatWebhook(original),
      ingestRevenueCatWebhook(original),
    ]);
    expect(results.sort()).toEqual(['ACCEPTED', 'DUPLICATE']);

    await expect(ingestRevenueCatWebhook(input(providerEventId, 'EXPIRATION'))).resolves.toBe('CONFLICT');
    await expect(ingestRevenueCatWebhook(input(providerEventId, 'EXPIRATION'))).resolves.toBe('CONFLICT');

    const event = await prisma.billingWebhookEvent.findUniqueOrThrow({
      where: { providerEventId },
      include: { observations: true },
    });
    expect(event).toMatchObject({
      eventType: 'INITIAL_PURCHASE',
      payloadHash: original.payloadHash,
      status: 'CONFLICT',
      attempts: 0,
      leaseUntil: null,
      lockedBy: null,
    });
    expect(event.observations).toHaveLength(1);
    expect(JSON.stringify(event.payloadRedacted)).not.toContain('must-not-be-persisted');
    expect(JSON.stringify(event.observations[0].payloadRedacted)).not.toContain('must-not-be-persisted');
    await expect(prisma.billingWebhookObservation.delete({
      where: { id: event.observations[0].id },
    })).rejects.toThrow();
  }, 20_000);

  test('database triggers reject evidence rewrites but allow status changes', async () => {
    const providerEventId = `${prefix}${randomUUID()}`;
    await ingestRevenueCatWebhook(input(providerEventId));
    const event = await prisma.billingWebhookEvent.findUniqueOrThrow({ where: { providerEventId } });

    await expect(prisma.billingWebhookEvent.update({
      where: { id: event.id },
      data: { payloadHash: 'a'.repeat(64) },
    })).rejects.toThrow();
    await expect(prisma.billingWebhookEvent.update({
      where: { id: event.id },
      data: { payloadPurgedAt: new Date() },
    })).rejects.toThrow();
    await expect(prisma.billingWebhookEvent.delete({ where: { id: event.id } })).rejects.toThrow();
    await expect(prisma.billingWebhookEvent.update({
      where: { id: event.id },
      data: {
        status: 'QUARANTINED',
        lastError: 'identity_unresolved',
        quarantineStartedAt: new Date(),
      },
    })).resolves.toMatchObject({ status: 'QUARANTINED' });
  }, 20_000);

  test('claims due events once and recovers an expired lease', async () => {
    const firstId = `${prefix}${randomUUID()}`;
    const secondId = `${prefix}${randomUUID()}`;
    await ingestRevenueCatWebhook(input(firstId));
    await ingestRevenueCatWebhook(input(secondId));
    await prisma.billingWebhookEvent.updateMany({
      where: { providerEventId: { in: [firstId, secondId] } },
      data: { nextAttemptAt: new Date(Date.now() - 60_000) },
    });

    const [firstClaim, secondClaim] = await Promise.all([
      webhookWorkerInternals.claimWebhookEvents('worker-a', 1),
      webhookWorkerInternals.claimWebhookEvents('worker-b', 1),
    ]);
    expect(firstClaim).toHaveLength(1);
    expect(secondClaim).toHaveLength(1);
    expect(firstClaim[0].id).not.toBe(secondClaim[0].id);

    await prisma.billingWebhookEvent.update({
      where: { id: firstClaim[0].id },
      data: { leaseUntil: new Date(Date.now() - 60_000) },
    });
    const recovered = await webhookWorkerInternals.claimWebhookEvents('worker-c', 1);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ id: firstClaim[0].id, attempts: 2 });
  }, 20_000);

  test('moves exhausted and expired quarantined events to dead letter', async () => {
    const exhaustedId = `${prefix}${randomUUID()}`;
    const expiredId = `${prefix}${randomUUID()}`;
    const activeId = `${prefix}${randomUUID()}`;
    await ingestRevenueCatWebhook(input(exhaustedId));
    await ingestRevenueCatWebhook(input(activeId));
    const expired = input(expiredId);
    await prisma.billingWebhookEvent.create({
      data: {
        providerEventId: expired.payload.event.id,
        eventType: expired.payload.event.type,
        payloadRedacted: expired.payloadRedacted,
        payloadHash: expired.payloadHash,
        status: 'QUARANTINED',
        receivedAt: new Date(Date.now() - 8 * 24 * 60 * 60_000),
        quarantineStartedAt: new Date(Date.now() - 8 * 24 * 60 * 60_000),
      },
    });
    await prisma.billingWebhookEvent.update({
      where: { providerEventId: exhaustedId },
      data: { status: 'RETRY', attempts: 12, nextAttemptAt: new Date(Date.now() - 60_000) },
    });
    await prisma.billingWebhookEvent.update({
      where: { providerEventId: activeId },
      data: {
        status: 'PROCESSING',
        attempts: 12,
        lockedBy: 'active-worker',
        leaseUntil: new Date(Date.now() + 60_000),
      },
    });
    await expect(webhookWorkerInternals.terminalizeExhaustedEvents()).resolves.toBe(2);
    const events = await prisma.billingWebhookEvent.findMany({
      where: { providerEventId: { in: [exhaustedId, expiredId] } },
      select: { status: true, lastError: true },
    });
    expect(events.every(({ status }) => status === 'DEAD_LETTER')).toBe(true);
    expect(events.map(({ lastError }) => lastError).sort())
      .toEqual(['attempts_exhausted', 'quarantine_expired']);
    await expect(prisma.billingWebhookEvent.findUniqueOrThrow({ where: { providerEventId: activeId } }))
      .resolves.toMatchObject({ status: 'PROCESSING', attempts: 12, lockedBy: 'active-worker' });
  }, 20_000);

  test('purges only due payloads from processed events', async () => {
    const providerEventId = `${prefix}${randomUUID()}`;
    const parsed = input(providerEventId);
    await prisma.billingWebhookEvent.create({
      data: {
        providerEventId: parsed.payload.event.id,
        eventType: parsed.payload.event.type,
        payloadRedacted: parsed.payloadRedacted,
        payloadHash: parsed.payloadHash,
        status: 'PROCESSED',
        processedAt: new Date(Date.now() - 91 * 24 * 60 * 60_000),
        receivedAt: new Date(Date.now() - 91 * 24 * 60 * 60_000),
      },
    });

    await expect(purgeProcessedWebhookPayloads()).resolves.toMatchObject({ processedCount: 1 });
    await expect(prisma.billingWebhookEvent.findUniqueOrThrow({ where: { providerEventId } }))
      .resolves.toMatchObject({ payloadRedacted: null, payloadPurgedAt: expect.any(Date) });
  }, 20_000);

  test.each(['APP_STORE', 'PLAY_STORE'])('completes an official sandbox TEST event from %s without identity or reconciliation', async (store) => {
    const providerEventId = `${prefix}${randomUUID()}`;
    const parsed = parseRevenueCatWebhook(Buffer.from(JSON.stringify({
      event: {
        id: providerEventId,
        type: 'TEST',
        environment: 'SANDBOX',
        store,
      },
    })));
    await ingestRevenueCatWebhook(parsed);
    await prisma.billingWebhookEvent.update({
      where: { providerEventId },
      data: { nextAttemptAt: new Date(Date.now() - 60_000) },
    });
    const [job] = await webhookWorkerInternals.claimWebhookEvents('test-worker', 1);
    const resolveIdentity = vi.fn();
    const reconcile = vi.fn();

    await webhookWorkerInternals.processWebhookEvent(job, 'test-worker', {
      resolveIdentity,
      reconcile,
    });

    expect(resolveIdentity).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    await expect(prisma.billingWebhookEvent.findUniqueOrThrow({ where: { providerEventId } }))
      .resolves.toMatchObject({ status: 'PROCESSED', processedAt: expect.any(Date), lastError: null });
  }, 20_000);

  test('serializes idempotent administrative replay and keeps its audit row immutable', async () => {
    const providerEventId = `${prefix}${randomUUID()}`;
    await ingestRevenueCatWebhook(input(providerEventId));
    const event = await prisma.billingWebhookEvent.update({
      where: { providerEventId },
      data: {
        status: 'QUARANTINED',
        attempts: 5,
        lastError: 'identity_unresolved',
        quarantineStartedAt: new Date(),
      },
    });
    const originalEnabled = env.BILLING_REVENUECAT_ENABLED;
    env.BILLING_REVENUECAT_ENABLED = true;
    try {
      const request = {
        eventId: event.id,
        reason: 'La identidad canonica ya fue corregida',
        idempotencyKey: `replay-${randomUUID()}`,
        actor: { userId: `admin-${randomUUID()}`, requestId: randomUUID() },
      };
      const [first, duplicate] = await Promise.all([
        replayAdminBillingWebhookEvent(request),
        replayAdminBillingWebhookEvent(request),
      ]);
      expect(duplicate).toEqual(first);
      await expect(replayAdminBillingWebhookEvent({
        ...request,
        reason: 'Una solicitud distinta no puede reutilizar la clave',
      })).rejects.toMatchObject({ statusCode: 409 });
      await expect(replayAdminBillingWebhookEvent({
        ...request,
        idempotencyKey: `replay-${randomUUID()}`,
      })).rejects.toMatchObject({ statusCode: 409 });
      await expect(prisma.billingWebhookEvent.findUniqueOrThrow({ where: { id: event.id } }))
        .resolves.toMatchObject({
          status: 'PENDING',
          attempts: 0,
          lastError: null,
          quarantineStartedAt: null,
          replayCount: 1,
          lastReplayAt: expect.any(Date),
        });
      const audits = await prisma.billingAuditLog.findMany({
        where: { billingWebhookEventId: event.id, action: 'WEBHOOK_REPLAY_REQUESTED' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        id: first.replayId,
        reason: request.reason,
        idempotencyKey: request.idempotencyKey,
      });
      await expect(prisma.billingAuditLog.update({
        where: { id: audits[0].id },
        data: { reason: 'Esta mutacion debe ser rechazada' },
      })).rejects.toThrow();
      await expect(prisma.billingAuditLog.delete({ where: { id: audits[0].id } })).rejects.toThrow();
    } finally {
      env.BILLING_REVENUECAT_ENABLED = originalEnabled;
    }
  }, 20_000);

  test('audits administrative queue reads without returning the stored payload', async () => {
    const providerEventId = `${prefix}${randomUUID()}`;
    await ingestRevenueCatWebhook(input(providerEventId));
    const event = await prisma.billingWebhookEvent.update({
      where: { providerEventId },
      data: {
        status: 'DEAD_LETTER',
        attempts: 12,
        lastError: 'provider_failure',
      },
    });
    const actor = { userId: `admin-${randomUUID()}`, requestId: randomUUID() };
    const queue = await listAdminBillingWebhookEvents({
      status: ['QUARANTINED', 'DEAD_LETTER'],
      limit: 25,
    }, actor);
    const listed = queue.items.find(({ id }) => id === event.id);
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty('payloadRedacted');

    const detail = await getAdminBillingWebhookEvent(event.id, actor);
    expect(detail).not.toHaveProperty('payloadRedacted');
    expect(detail.identityCandidates).toContain('billing_account-integration');
    await expect(prisma.billingAuditLog.findMany({
      where: { billingWebhookEventId: event.id },
      select: { action: true },
    })).resolves.toEqual([{ action: 'WEBHOOK_EVENT_VIEWED' }]);
    await expect(prisma.billingAuditLog.count({
      where: { actorUserIdSnapshot: actor.userId, action: 'WEBHOOK_QUEUE_VIEWED' },
    })).resolves.toBe(1);
  }, 20_000);

  test('rolls back a dead-letter replay when its audit insert fails and preserves evidence', async () => {
    const providerEventId = `${prefix}${randomUUID()}`;
    await ingestRevenueCatWebhook(input(providerEventId));
    const event = await prisma.billingWebhookEvent.update({
      where: { providerEventId },
      data: { status: 'DEAD_LETTER', attempts: 12, lastError: 'attempts_exhausted' },
    });
    const originalEnabled = env.BILLING_REVENUECAT_ENABLED;
    env.BILLING_REVENUECAT_ENABLED = true;
    try {
      const replay = {
        eventId: event.id,
        reason: 'La falla transitoria del proveedor ya fue resuelta',
        idempotencyKey: `replay-${randomUUID()}`,
        actor: { userId: `admin-${randomUUID()}`, requestId: 'r'.repeat(129) },
      };
      await expect(replayAdminBillingWebhookEvent(replay)).rejects.toThrow();
      await expect(prisma.billingWebhookEvent.findUniqueOrThrow({ where: { id: event.id } }))
        .resolves.toMatchObject({ status: 'DEAD_LETTER', attempts: 12, replayCount: 0 });

      await replayAdminBillingWebhookEvent({
        ...replay,
        actor: { ...replay.actor, requestId: 'r'.repeat(128) },
      });
      const replayed = await prisma.billingWebhookEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(replayed).toMatchObject({
        status: 'PENDING',
        replayCount: 1,
        payloadHash: event.payloadHash,
        payloadRedacted: event.payloadRedacted,
        receivedAt: event.receivedAt,
      });
    } finally {
      env.BILLING_REVENUECAT_ENABLED = originalEnabled;
    }
  }, 20_000);
});
