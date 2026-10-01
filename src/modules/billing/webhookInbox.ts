import { createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { Sentry } from '../../instrument';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';

const canonicalBillingIdentity = /^billing_[A-Za-z0-9_-]{1,92}$/;

const revenueCatWebhookSchema = z.object({
  api_version: z.string().trim().min(1).max(50).optional(),
  event: z.object({
    id: z.string().trim().min(1).max(255),
    type: z.string().trim().min(1).max(100),
    app_user_id: z.string().trim().min(1).max(255).optional(),
    original_app_user_id: z.string().trim().min(1).max(255).optional(),
    aliases: z.array(z.string().trim().min(1).max(255)).max(100).optional(),
    environment: z.string().trim().min(1).max(50).optional(),
    store: z.string().trim().min(1).max(50).optional(),
  }).passthrough(),
}).passthrough();

const redactedWebhookPayloadSchema = z.object({
  apiVersion: z.string().max(50).nullable(),
  event: z.object({
    id: z.string().min(1).max(255),
    type: z.string().min(1).max(100),
    appUserId: z.string().max(100).nullable(),
    originalAppUserId: z.string().max(100).nullable(),
    aliases: z.array(z.string().max(100)).max(100),
    environment: z.string().max(50).nullable(),
    store: z.string().max(50).nullable(),
  }),
});

export type RevenueCatWebhookInput = z.output<typeof revenueCatWebhookSchema>;
export type RedactedRevenueCatWebhookPayload = z.output<typeof redactedWebhookPayloadSchema>;
export type BillingWebhookIngestResult = 'ACCEPTED' | 'DUPLICATE' | 'CONFLICT';

function canonicalIdentity(value: string | undefined): string | null {
  return value && canonicalBillingIdentity.test(value) ? value : null;
}

function redactedPayload(payload: RevenueCatWebhookInput): RedactedRevenueCatWebhookPayload {
  return {
    apiVersion: payload.api_version ?? null,
    event: {
      id: payload.event.id,
      type: payload.event.type,
      appUserId: canonicalIdentity(payload.event.app_user_id),
      originalAppUserId: canonicalIdentity(payload.event.original_app_user_id),
      aliases: [...new Set((payload.event.aliases ?? [])
        .map((alias) => canonicalIdentity(alias))
        .filter((alias): alias is string => alias !== null))],
      environment: payload.event.environment ?? null,
      store: payload.event.store ?? null,
    },
  };
}

export function parseRedactedRevenueCatWebhookPayload(value: unknown): RedactedRevenueCatWebhookPayload {
  const parsed = redactedWebhookPayloadSchema.safeParse(value);
  if (!parsed.success) throw new TypeError('invalid_redacted_webhook_payload');
  return parsed.data;
}

export function parseRevenueCatWebhook(rawBody: Buffer): {
  payload: RevenueCatWebhookInput;
  payloadHash: string;
  payloadRedacted: Prisma.InputJsonValue;
} {
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new TypeError('invalid_json');
  }
  const parsed = revenueCatWebhookSchema.safeParse(decoded);
  if (!parsed.success) throw new TypeError('invalid_webhook');
  return {
    payload: parsed.data,
    payloadHash: createHash('sha256').update(rawBody).digest('hex'),
    payloadRedacted: redactedPayload(parsed.data),
  };
}

export async function ingestRevenueCatWebhook(
  input: ReturnType<typeof parseRevenueCatWebhook>,
  client: PrismaClient = prisma,
): Promise<BillingWebhookIngestResult> {
  const result = await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing-webhook:${input.payload.event.id}`}))`;
    const existing = await tx.billingWebhookEvent.findUnique({
      where: { providerEventId: input.payload.event.id },
      select: { id: true, payloadHash: true },
    });
    if (!existing) {
      await tx.billingWebhookEvent.create({
        data: {
          providerEventId: input.payload.event.id,
          eventType: input.payload.event.type,
          payloadHash: input.payloadHash,
          payloadRedacted: input.payloadRedacted,
        },
      });
      return 'ACCEPTED';
    }
    if (existing.payloadHash === input.payloadHash) return 'DUPLICATE';

    await tx.billingWebhookObservation.upsert({
      where: {
        billingWebhookEventId_payloadHash: {
          billingWebhookEventId: existing.id,
          payloadHash: input.payloadHash,
        },
      },
      create: {
        billingWebhookEventId: existing.id,
        payloadHash: input.payloadHash,
        payloadRedacted: input.payloadRedacted,
        conflictReason: 'provider_event_id_reused_with_different_payload',
      },
      update: {},
    });
    await tx.billingWebhookEvent.update({
      where: { id: existing.id },
      data: {
        status: 'CONFLICT',
        lastError: 'provider_event_id_reused_with_different_payload',
        processedAt: null,
        leaseUntil: null,
        lockedBy: null,
      },
    });
    return 'CONFLICT';
  });
  if (result === 'CONFLICT') {
    Sentry.captureMessage('RevenueCat webhook hash conflict', {
      level: 'error',
      tags: { provider: 'revenuecat', operation: 'ingest_webhook', reason: 'provider_event_id_reused' },
    });
    logger.error({
      event: 'billing.webhook_hash_conflict',
      reason: 'provider_event_id_reused_with_different_payload',
    }, 'RevenueCat webhook hash conflict');
  }
  return result;
}

export const webhookInboxInternals = { canonicalIdentity, redactedPayload, revenueCatWebhookSchema };
