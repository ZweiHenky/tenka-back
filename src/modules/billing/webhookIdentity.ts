import { prisma } from '../../config/database';
import type { PrismaClient } from '../../generated/prisma/client';
import type { RedactedRevenueCatWebhookPayload } from './webhookInbox';

export type BillingWebhookIdentityErrorCode = 'IDENTITY_UNRESOLVED' | 'IDENTITY_CONFLICT';

export class BillingWebhookIdentityError extends Error {
  constructor(public readonly code: BillingWebhookIdentityErrorCode) {
    super(`Billing webhook identity resolution failed (${code})`);
    this.name = 'BillingWebhookIdentityError';
  }
}

export async function resolveWebhookBillingAccount(
  payload: RedactedRevenueCatWebhookPayload,
  client: PrismaClient = prisma,
): Promise<string> {
  const candidates = [...new Set([
    payload.event.appUserId,
    payload.event.originalAppUserId,
    ...payload.event.aliases,
  ].filter((value): value is string => value !== null))];
  if (candidates.length === 0) throw new BillingWebhookIdentityError('IDENTITY_UNRESOLVED');

  const identities = await client.billingProviderIdentity.findMany({
    where: { revenueCatAppUserId: { in: candidates } },
    select: { billingAccountId: true },
  });
  const accountIds = [...new Set(identities.map(({ billingAccountId }) => billingAccountId))];
  if (accountIds.length === 0) throw new BillingWebhookIdentityError('IDENTITY_UNRESOLVED');
  if (accountIds.length > 1) throw new BillingWebhookIdentityError('IDENTITY_CONFLICT');
  return accountIds[0];
}
