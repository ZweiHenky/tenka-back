import { createHash } from 'node:crypto';
import { env } from '../../config/env';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { Prisma, type BillingWebhookEventStatus } from '../../generated/prisma/client';
import { AppError, ConflictError, NotFoundError } from '../../utils/errors';
import { configureRawQuerySchema } from '../../utils/rawDatabaseSchema';
import { signalBackgroundJob } from '../../workers/jobSignals';
import { parseRedactedRevenueCatWebhookPayload } from './webhookInbox';
import type { BillingWebhookListQuery } from './adminWebhookValidator';

const EVENT_SELECT = {
  id: true,
  providerEventId: true,
  eventType: true,
  status: true,
  attempts: true,
  nextAttemptAt: true,
  leaseUntil: true,
  lastError: true,
  receivedAt: true,
  processedAt: true,
  payloadPurgedAt: true,
  quarantineStartedAt: true,
  replayCount: true,
  lastReplayAt: true,
} satisfies Prisma.BillingWebhookEventSelect;

interface AdminActor {
  userId: string;
  requestId: string;
}

interface LockedWebhookEvent {
  id: string;
  status: BillingWebhookEventStatus;
  attempts: number;
  lastError: string | null;
  payloadRedacted: unknown;
  replayCount: number;
}

interface ReplayMetadata {
  previousStatus: BillingWebhookEventStatus;
  previousAttempts: number;
  previousErrorCode: string | null;
  resultingStatus: 'PENDING';
  replayCount: number;
}

export interface BillingWebhookReplayResult {
  eventId: string;
  replayId: string;
  status: 'PENDING';
  replayCount: number;
}

function requestFingerprint(eventId: string, reason: string): string {
  return createHash('sha256').update(JSON.stringify({ eventId, reason })).digest('hex');
}

function metadataAsReplay(value: Prisma.JsonValue): ReplayMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_replay_audit_metadata');
  const metadata = value as Record<string, unknown>;
  if (metadata.resultingStatus !== 'PENDING' || typeof metadata.replayCount !== 'number') {
    throw new Error('invalid_replay_audit_metadata');
  }
  return metadata as unknown as ReplayMetadata;
}

async function auditRead(
  tx: Prisma.TransactionClient,
  actor: AdminActor,
  action: 'WEBHOOK_QUEUE_VIEWED' | 'WEBHOOK_EVENT_VIEWED',
  targetId: string,
  metadataRedacted: Prisma.InputJsonValue,
  billingWebhookEventId?: string,
): Promise<void> {
  await tx.billingAuditLog.create({
    data: {
      action,
      actorType: 'USER',
      actorUserId: actor.userId,
      actorUserIdSnapshot: actor.userId,
      billingWebhookEventId,
      targetType: billingWebhookEventId ? 'BILLING_WEBHOOK_EVENT' : 'BILLING_WEBHOOK_QUEUE',
      targetId,
      requestId: actor.requestId,
      metadataRedacted,
    },
  });
}

export async function listAdminBillingWebhookEvents(query: BillingWebhookListQuery, actor: AdminActor) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.billingWebhookEvent.findMany({
      where: { status: { in: query.status } },
      select: EVENT_SELECT,
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    await auditRead(tx, actor, 'WEBHOOK_QUEUE_VIEWED', 'quarantined-and-dead-letter', {
      statuses: query.status,
      resultCount: items.length,
    });
    return {
      items,
      nextCursor: hasMore ? items.at(-1)!.id : null,
    };
  });
}

export async function getAdminBillingWebhookEvent(eventId: string, actor: AdminActor) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.billingWebhookEvent.findUnique({
      where: { id: eventId },
      select: { ...EVENT_SELECT, payloadRedacted: true },
    });
    if (!event) throw new NotFoundError('Evento webhook');
    let identityCandidates: string[] = [];
    let payloadValid = event.payloadRedacted !== null;
    if (event.payloadRedacted !== null) {
      try {
        const payload = parseRedactedRevenueCatWebhookPayload(event.payloadRedacted);
        identityCandidates = [...new Set([
          payload.event.appUserId,
          payload.event.originalAppUserId,
          ...payload.event.aliases,
        ].filter((value): value is string => value !== null))];
      } catch {
        payloadValid = false;
      }
    }
    await auditRead(tx, actor, 'WEBHOOK_EVENT_VIEWED', event.id, {
      status: event.status,
      identityCandidateCount: identityCandidates.length,
    }, event.id);
    const { payloadRedacted: _payload, ...safeEvent } = event;
    return { ...safeEvent, payloadValid, identityCandidates };
  });
}

export async function replayAdminBillingWebhookEvent(input: {
  eventId: string;
  reason: string;
  idempotencyKey: string;
  actor: AdminActor;
}): Promise<BillingWebhookReplayResult> {
  if (!env.BILLING_REVENUECAT_ENABLED) {
    throw new AppError(503, 'La integración de RevenueCat está deshabilitada', 'BILLING_REVENUECAT_DISABLED');
  }
  const fingerprint = requestFingerprint(input.eventId, input.reason);
  const result = await prisma.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    const [event] = await tx.$queryRaw<LockedWebhookEvent[]>`
      SELECT id, status, attempts, "lastError", "payloadRedacted", "replayCount"
      FROM billing_webhook_events
      WHERE id = ${input.eventId}
      FOR UPDATE
    `;
    if (!event) throw new NotFoundError('Evento webhook');

    const existing = await tx.billingAuditLog.findFirst({
      where: {
        actorUserIdSnapshot: input.actor.userId,
        action: 'WEBHOOK_REPLAY_REQUESTED',
        targetType: 'BILLING_WEBHOOK_EVENT',
        targetId: input.eventId,
        idempotencyKey: input.idempotencyKey,
      },
      select: { id: true, requestFingerprint: true, metadataRedacted: true },
    });
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new ConflictError('Idempotency-Key ya fue utilizada con otra solicitud');
      }
      const metadata = metadataAsReplay(existing.metadataRedacted);
      return {
        eventId: event.id,
        replayId: existing.id,
        status: metadata.resultingStatus,
        replayCount: metadata.replayCount,
      };
    }

    if (event.status !== 'QUARANTINED' && event.status !== 'DEAD_LETTER') {
      throw new ConflictError(`El evento no puede reproducirse desde el estado ${event.status}`);
    }
    if (event.payloadRedacted === null) throw new ConflictError('La evidencia del evento ya fue purgada');
    try {
      parseRedactedRevenueCatWebhookPayload(event.payloadRedacted);
    } catch {
      throw new ConflictError('La evidencia redactada del evento no es valida para replay');
    }

    const [updated] = await tx.$queryRaw<Array<{ replayCount: number }>>`
      UPDATE billing_webhook_events
      SET status = 'PENDING', attempts = 0, "nextAttemptAt" = NOW(),
          "leaseUntil" = NULL, "lockedBy" = NULL, "lastError" = NULL,
          "processedAt" = NULL, "quarantineStartedAt" = NULL,
          "replayCount" = "replayCount" + 1, "lastReplayAt" = NOW(), "updatedAt" = NOW()
      WHERE id = ${event.id} AND status IN ('QUARANTINED', 'DEAD_LETTER')
      RETURNING "replayCount"
    `;
    if (!updated) throw new ConflictError('El estado del evento cambió durante el replay');
    const metadata: ReplayMetadata = {
      previousStatus: event.status,
      previousAttempts: event.attempts,
      previousErrorCode: event.lastError,
      resultingStatus: 'PENDING',
      replayCount: updated.replayCount,
    };
    const audit = await tx.billingAuditLog.create({
      data: {
        action: 'WEBHOOK_REPLAY_REQUESTED',
        actorType: 'USER',
        actorUserId: input.actor.userId,
        actorUserIdSnapshot: input.actor.userId,
        billingWebhookEventId: event.id,
        targetType: 'BILLING_WEBHOOK_EVENT',
        targetId: event.id,
        reason: input.reason,
        requestId: input.actor.requestId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint,
        metadataRedacted: metadata as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return { eventId: event.id, replayId: audit.id, status: 'PENDING' as const, replayCount: updated.replayCount };
  });
  signalBackgroundJob('billing-webhook');
  logger.info({
    event: 'billing.webhook_replay_requested',
    status: result.status,
    replayCount: result.replayCount,
  }, 'Billing webhook replay requested');
  return result;
}

export const adminWebhookInternals = { requestFingerprint, metadataAsReplay };
