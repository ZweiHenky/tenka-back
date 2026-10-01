import { describe, expect, it } from 'vitest';
import {
  billingAdminIdempotencyKeySchema,
  billingOperationalControlBodySchema,
} from './operationalControlValidator';

describe('billing operational control validation', () => {
  it('normalizes a complete change request', () => {
    expect(billingOperationalControlBodySchema.parse({
      mode: 'PURCHASES_PAUSED',
      reason: '  Pause purchases during incident response  ',
      expectedVersion: 3,
    })).toEqual({
      mode: 'PURCHASES_PAUSED',
      reason: 'Pause purchases during incident response',
      expectedVersion: 3,
    });
  });

  it('rejects unknown fields, weak reasons, invalid versions and keys', () => {
    expect(() => billingOperationalControlBodySchema.parse({
      mode: 'ENABLED', reason: 'too short', expectedVersion: 1,
    })).toThrow();
    expect(() => billingOperationalControlBodySchema.parse({
      mode: 'ENABLED', reason: 'Valid operational reason', expectedVersion: 0,
    })).toThrow();
    expect(() => billingOperationalControlBodySchema.parse({
      mode: 'ENABLED', reason: 'Valid operational reason', expectedVersion: 1, extra: true,
    })).toThrow();
    expect(() => billingAdminIdempotencyKeySchema.parse('invalid key spaces')).toThrow();
  });
});
