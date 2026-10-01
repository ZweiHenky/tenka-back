import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseRevenueCatWebhook } from './webhookInbox';

describe('RevenueCat webhook parsing', () => {
  it('hashes the raw body and retains only bounded operational evidence', () => {
    const raw = Buffer.from(JSON.stringify({
      api_version: '1.0',
      event: {
        id: 'event-1',
        type: 'INITIAL_PURCHASE',
        app_user_id: 'billing_account-1',
        original_app_user_id: 'private@example.com',
        aliases: ['private@example.com', 'billing_alias-1', 'billing_alias-1'],
        environment: 'SANDBOX',
        store: 'PLAY_STORE',
        transaction_id: 'private-transaction',
        subscriber_attributes: { email: 'private@example.com' },
      },
    }));

    const result = parseRevenueCatWebhook(raw);

    expect(result.payloadHash).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(result.payloadRedacted).toEqual({
      apiVersion: '1.0',
      event: {
        id: 'event-1',
        type: 'INITIAL_PURCHASE',
        appUserId: 'billing_account-1',
        originalAppUserId: null,
        aliases: ['billing_alias-1'],
        environment: 'SANDBOX',
        store: 'PLAY_STORE',
      },
    });
    expect(JSON.stringify(result.payloadRedacted)).not.toContain('private');
  });

  it.each([
    Buffer.from('{'),
    Buffer.from(JSON.stringify({ event: { type: 'RENEWAL' } })),
    Buffer.from(JSON.stringify({ event: { id: 'event-1', type: '' } })),
  ])('rejects malformed or incomplete payloads', (raw) => {
    expect(() => parseRevenueCatWebhook(raw)).toThrow('invalid_');
  });
});
