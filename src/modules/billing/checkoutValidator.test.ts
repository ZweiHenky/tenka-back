import { describe, expect, it } from 'vitest';
import {
  billingCheckoutAbandonBodySchema,
  billingCheckoutOutcomeBodySchema,
  billingCheckoutStartBodySchema,
  billingSyncBodySchema,
} from './checkoutValidator';

describe('billing checkout validation', () => {
  it('accepts only Google checkout starts with a positive selection version', () => {
    expect(billingCheckoutStartBodySchema.parse({
      purchaseSelectionId: 'selection-1', expectedVersion: 2, store: 'GOOGLE',
    })).toEqual({ purchaseSelectionId: 'selection-1', expectedVersion: 2, store: 'GOOGLE' });
    expect(() => billingCheckoutStartBodySchema.parse({
      purchaseSelectionId: 'selection-1', expectedVersion: 0, store: 'GOOGLE',
    })).toThrow();
    expect(() => billingCheckoutStartBodySchema.parse({
      purchaseSelectionId: 'selection-1', expectedVersion: 1, store: 'APPLE',
    })).toThrow();
  });

  it('keeps outcomes and sync bodies strict', () => {
    expect(billingCheckoutOutcomeBodySchema.parse({ outcome: 'SDK_CONFIRMED' }))
      .toEqual({ outcome: 'SDK_CONFIRMED' });
    expect(() => billingCheckoutOutcomeBodySchema.parse({ outcome: 'SUCCESS' })).toThrow();
    expect(billingSyncBodySchema.parse({})).toEqual({});
    expect(() => billingSyncBodySchema.parse({ receipt: 'private' })).toThrow();
  });

  it('accepts only a positive PostgreSQL integer version for abandonment', () => {
    expect(billingCheckoutAbandonBodySchema.parse({ expectedVersion: 2 })).toEqual({ expectedVersion: 2 });
    for (const expectedVersion of [0, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
      expect(() => billingCheckoutAbandonBodySchema.parse({ expectedVersion })).toThrow();
    }
    expect(() => billingCheckoutAbandonBodySchema.parse({ expectedVersion: 2, receipt: 'private' })).toThrow();
  });
});
