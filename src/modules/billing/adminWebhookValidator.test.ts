import { describe, expect, it } from 'vitest';
import {
  billingWebhookIdempotencyKeySchema,
  billingWebhookListQuerySchema,
  billingWebhookReplayBodySchema,
} from './adminWebhookValidator';

describe('billing webhook administration validation', () => {
  it('defaults the queue to replay-eligible statuses and bounds pagination', () => {
    expect(billingWebhookListQuerySchema.parse({})).toEqual({
      status: ['QUARANTINED', 'DEAD_LETTER'],
      limit: 25,
    });
    expect(billingWebhookListQuerySchema.safeParse({ status: 'PENDING' }).success).toBe(false);
    expect(billingWebhookListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('requires a meaningful reason and a restricted idempotency key', () => {
    expect(billingWebhookReplayBodySchema.parse({ reason: '  Identidad reparada  ' }))
      .toEqual({ reason: 'Identidad reparada' });
    expect(billingWebhookReplayBodySchema.safeParse({ reason: 'corto' }).success).toBe(false);
    expect(billingWebhookIdempotencyKeySchema.safeParse('replay:key-123').success).toBe(true);
    expect(billingWebhookIdempotencyKeySchema.safeParse('replay key 123').success).toBe(false);
  });
});
