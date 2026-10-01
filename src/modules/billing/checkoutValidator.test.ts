import { describe, expect, it } from 'vitest';
import {
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
});
