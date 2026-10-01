import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client';
import type { RedactedRevenueCatWebhookPayload } from './webhookInbox';
import { resolveWebhookBillingAccount } from './webhookIdentity';

const payload: RedactedRevenueCatWebhookPayload = {
  apiVersion: '1.0',
  event: {
    id: 'event-1',
    type: 'RENEWAL',
    appUserId: 'billing_primary',
    originalAppUserId: 'billing_original',
    aliases: ['billing_alias'],
    environment: 'SANDBOX',
    store: 'PLAY_STORE',
  },
};

function clientWithAccounts(accountIds: string[]): PrismaClient {
  return {
    billingProviderIdentity: {
      findMany: vi.fn().mockResolvedValue(accountIds.map((billingAccountId) => ({ billingAccountId }))),
    },
  } as unknown as PrismaClient;
}

describe('resolveWebhookBillingAccount', () => {
  it('resolves canonical and alias evidence to one account', async () => {
    const client = clientWithAccounts(['account-1', 'account-1']);
    await expect(resolveWebhookBillingAccount(payload, client)).resolves.toBe('account-1');
    expect(client.billingProviderIdentity.findMany).toHaveBeenCalledWith({
      where: { revenueCatAppUserId: { in: ['billing_primary', 'billing_original', 'billing_alias'] } },
      select: { billingAccountId: true },
    });
  });

  it('quarantines missing and contradictory identity evidence', async () => {
    await expect(resolveWebhookBillingAccount(payload, clientWithAccounts([])))
      .rejects.toMatchObject({ code: 'IDENTITY_UNRESOLVED' });
    await expect(resolveWebhookBillingAccount(payload, clientWithAccounts(['account-1', 'account-2'])))
      .rejects.toMatchObject({ code: 'IDENTITY_CONFLICT' });
  });
});
