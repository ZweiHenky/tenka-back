import { describe, expect, it } from 'vitest';
import {
  billingChangeIdempotencyKeySchema,
  billingChangeConfirmBodySchema,
  billingChangeFinalStepConfirmBodySchema,
  billingChangeOperationParamsSchema,
  billingChangePreviewBodySchema,
} from './changePreviewValidator';

describe('billing change preview validation', () => {
  it('accepts only a recognized target shape', () => {
    expect(billingChangePreviewBodySchema.parse({
      logicalProductId: ' tenka_capacity_6 ', billingInterval: 'ANNUAL',
    })).toEqual({ logicalProductId: 'tenka_capacity_6', billingInterval: 'ANNUAL' });
    expect(() => billingChangePreviewBodySchema.parse({
      logicalProductId: 'tenka_capacity_6', billingInterval: 'ANNUAL', price: '99.00',
    })).toThrow();
    expect(() => billingChangePreviewBodySchema.parse({
      logicalProductId: 'tenka_capacity_6', billingInterval: 'WEEKLY',
    })).toThrow();
  });

  it('requires source and preview concurrency facts for both confirmations', () => {
    expect(billingChangeConfirmBodySchema.parse({
      targetVariantId: 'target-1', expectedSourceVariantId: 'source-1', previewFingerprint: 'a'.repeat(64),
    })).toEqual({
      targetVariantId: 'target-1', expectedSourceVariantId: 'source-1', previewFingerprint: 'a'.repeat(64),
    });
    expect(() => billingChangeConfirmBodySchema.parse({
      targetVariantId: 'target-1', expectedSourceVariantId: 'source-1', previewFingerprint: 'stale',
    })).toThrow();
    expect(billingChangeFinalStepConfirmBodySchema.parse({ expectedVersion: 4 })).toEqual({ expectedVersion: 4 });
    expect(() => billingChangeFinalStepConfirmBodySchema.parse({ expectedVersion: 0 })).toThrow();
  });

  it('normalizes operation ids and requires a safe idempotency key', () => {
    expect(billingChangeOperationParamsSchema.parse({ operationId: ' operation-1 ' }))
      .toEqual({ operationId: 'operation-1' });
    expect(() => billingChangeOperationParamsSchema.parse({ operationId: 'operation-1', accountId: 'other' }))
      .toThrow();
    expect(billingChangeIdempotencyKeySchema.parse('change-key-0001')).toBe('change-key-0001');
    expect(() => billingChangeIdempotencyKeySchema.parse('short')).toThrow();
  });
});
