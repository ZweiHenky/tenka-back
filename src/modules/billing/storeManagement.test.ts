import { describe, expect, it, vi, beforeEach } from 'vitest';

const warn = vi.fn();
vi.mock('../../config/logger', () => ({
  logger: { warn: (...args: unknown[]) => warn(...args), info: vi.fn(), error: vi.fn() },
}));

import {
  resolveSubscriptionManagement,
  storeSubscriptionManagementUrl,
} from './storeManagement';

function subscription(overrides: Partial<{
  id: string;
  store: 'APPLE' | 'GOOGLE';
  currentStoreProductId: string | null;
  entitlementActive: boolean;
  providerStatusUpdatedAt: Date;
  willRenew: boolean | null;
}> = {}) {
  return {
    id: 'sub-1',
    store: 'GOOGLE' as const,
    currentStoreProductId: 'tenka_capacity_3',
    entitlementActive: true,
    providerStatusUpdatedAt: new Date('2026-01-02T00:00:00.000Z'),
    willRenew: true,
    ...overrides,
  };
}

function clientWith(subscriptions: unknown[]) {
  return {
    billingProviderSubscriptionChain: {
      findMany: vi.fn().mockResolvedValue(subscriptions.map((items) => ({ subscriptions: items }))),
    },
  };
}

beforeEach(() => {
  warn.mockClear();
});

describe('storeSubscriptionManagementUrl', () => {
  it('deep links Google Play to the exact subscription product', () => {
    expect(storeSubscriptionManagementUrl('GOOGLE', 'tenka_capacity_3')).toBe(
      'https://play.google.com/store/account/subscriptions?sku=tenka_capacity_3&package=studio.tenka.app',
    );
  });

  it('falls back to the store-wide Google Play subscriptions page without a product', () => {
    expect(storeSubscriptionManagementUrl('GOOGLE', null)).toBe(
      'https://play.google.com/store/account/subscriptions?package=studio.tenka.app',
    );
  });

  it('uses the App Store subscriptions page because Apple has no per-product deep link', () => {
    expect(storeSubscriptionManagementUrl('APPLE', 'studio.tenka.capacity3.monthly.v1')).toBe(
      'https://apps.apple.com/account/subscriptions',
    );
  });

  it('percent-encodes the sku and the package id', () => {
    expect(storeSubscriptionManagementUrl('GOOGLE', 'a b&c')).toContain('sku=a%20b%26c&');
  });
});

describe('resolveSubscriptionManagement', () => {
  it('resolves nothing without a billing account', async () => {
    const client = clientWith([[subscription()]]);
    await expect(resolveSubscriptionManagement(null, client)).resolves.toBeNull();
    expect(client.billingProviderSubscriptionChain.findMany).not.toHaveBeenCalled();
  });

  it('resolves nothing when the client has no provider ledger', async () => {
    await expect(resolveSubscriptionManagement('billing-1', { billingAccount: {} })).resolves.toBeNull();
  });

  it('returns null when the account has no manageable subscription', async () => {
    await expect(resolveSubscriptionManagement('billing-1', clientWith([[]]))).resolves.toBeNull();
  });

  it('builds the Google Play management url for the active entitlement', async () => {
    const result = await resolveSubscriptionManagement('billing-1', clientWith([[subscription()]]));
    expect(result).toEqual({
      url: 'https://play.google.com/store/account/subscriptions?sku=tenka_capacity_3&package=studio.tenka.app',
      store: 'GOOGLE',
      storeProductId: 'tenka_capacity_3',
      willRenew: true,
    });
  });

  it('keeps a canceled but still entitled subscription manageable', async () => {
    const result = await resolveSubscriptionManagement('billing-1', clientWith([[
      subscription({ entitlementActive: true, willRenew: false }),
    ]]));
    expect(result).toMatchObject({ store: 'GOOGLE', willRenew: false });
  });

  it('prefers the entitlement-active subscription over a newer inactive one', async () => {
    const result = await resolveSubscriptionManagement('billing-1', clientWith([[
      subscription({
        id: 'sub-old',
        currentStoreProductId: 'tenka_capacity_2',
        entitlementActive: true,
        providerStatusUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      subscription({
        id: 'sub-new',
        currentStoreProductId: 'tenka_capacity_5',
        entitlementActive: false,
        providerStatusUpdatedAt: new Date('2026-03-01T00:00:00.000Z'),
      }),
    ]]));
    expect(result).toMatchObject({ storeProductId: 'tenka_capacity_2' });
  });

  it('keeps a paused subscription reachable even without an active entitlement', async () => {
    const result = await resolveSubscriptionManagement('billing-1', clientWith([[
      subscription({ entitlementActive: false, currentStoreProductId: null }),
    ]]));
    expect(result).toMatchObject({
      store: 'GOOGLE',
      storeProductId: null,
      url: 'https://play.google.com/store/account/subscriptions?package=studio.tenka.app',
    });
  });

  it('returns the App Store page for an Apple subscription', async () => {
    const result = await resolveSubscriptionManagement('billing-1', clientWith([[
      subscription({ store: 'APPLE', currentStoreProductId: 'studio.tenka.capacity3.monthly.v1' }),
    ]]));
    expect(result).toEqual({
      url: 'https://apps.apple.com/account/subscriptions',
      store: 'APPLE',
      storeProductId: 'studio.tenka.capacity3.monthly.v1',
      willRenew: true,
    });
  });

  it('never lets a ledger failure break the billing state', async () => {
    const client = {
      billingProviderSubscriptionChain: {
        findMany: vi.fn().mockRejectedValue(new Error('connection reset')),
      },
    };
    await expect(resolveSubscriptionManagement('billing-1', client)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'billing.store_management_resolution_failed' }),
      expect.any(String),
    );
  });
});
