import { describe, expect, it } from 'vitest';
import { billingPurchaseSelectionBodySchema } from './purchaseSelectionValidator';

describe('billing purchase selection validation', () => {
  it('normalizes a valid draft request', () => {
    expect(billingPurchaseSelectionBodySchema.parse({
      logicalProductId: '  tenka_capacity_3  ',
      billingInterval: 'MONTHLY',
      divisionIds: [' division-a ', 'division-b'],
      expectedVersion: 0,
    })).toEqual({
      logicalProductId: 'tenka_capacity_3',
      billingInterval: 'MONTHLY',
      divisionIds: ['division-a', 'division-b'],
      expectedVersion: 0,
    });
  });

  it('rejects duplicate divisions, unknown fields and invalid versions', () => {
    expect(() => billingPurchaseSelectionBodySchema.parse({
      logicalProductId: 'tenka_capacity_3', billingInterval: 'MONTHLY',
      divisionIds: ['division-a', 'division-a'], expectedVersion: 0,
    })).toThrow('divisionIds no puede contener divisiones repetidas');
    expect(() => billingPurchaseSelectionBodySchema.parse({
      logicalProductId: 'tenka_capacity_3', billingInterval: 'MONTHLY',
      divisionIds: [], expectedVersion: -1,
    })).toThrow();
    expect(() => billingPurchaseSelectionBodySchema.parse({
      logicalProductId: 'tenka_capacity_3', billingInterval: 'MONTHLY',
      divisionIds: [], expectedVersion: 0, targetCapacity: 3,
    })).toThrow();
  });
});
