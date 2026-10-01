import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../utils/errors';
import type { BillingCatalogDto, BillingCatalogProductInput } from './types';
import type { RevenueCatCustomerSnapshot } from './revenueCatSchemas';
import { RevenueCatProviderError } from './revenueCatClient';
import type { NormalizedGoogleCustomer } from './providerNormalizer';

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../config/logger', () => ({ logger: loggerMock }));

import { reconcileRevenueCatGoogleLedger } from './reconciliation';

const product: BillingCatalogProductInput = {
  id: 'product-row-1',
  logicalProductId: 'tenka_capacity_2',
  store: 'GOOGLE',
  storeProductId: 'tenka_capacity_2',
  basePlanId: 'monthly',
  revenueCatOfferingId: 'capacity_2',
  revenueCatPackageId: '$rc_monthly',
  revenueCatProductIdentifier: 'tenka_capacity_2:monthly',
  capacity: 2,
  billingInterval: 'MONTHLY',
  intervalMonths: 1,
  active: true,
};

function catalog(environment: 'PREVIEW' | 'PRODUCTION' = 'PREVIEW'): BillingCatalogDto {
  return {
    available: true,
    environment,
    release: { id: 'release-1', version: 'test-v1', products: [product] },
    purchasesEnabled: false,
  };
}

function snapshot(
  billingAccountId = 'billing_account-1',
  overrides: Partial<RevenueCatCustomerSnapshot['subscriptions'][number]> = {},
): RevenueCatCustomerSnapshot {
  const purchasedAtMs = Date.parse('2026-09-01T12:00:00Z');
  const expirationMs = Date.parse('2026-10-01T12:00:00Z');
  return {
    customerId: billingAccountId,
    storeEnvironment: 'sandbox',
    observedAt: '2026-09-15T12:00:00.000Z',
    subscriptions: [{
      id: 'sub_google_1',
      customerId: billingAccountId,
      originalCustomerId: billingAccountId,
      productId: 'provider-product-1',
      startsAtMs: purchasedAtMs,
      currentPeriodStartsAtMs: purchasedAtMs,
      currentPeriodEndsAtMs: expirationMs,
      endsAtMs: expirationMs,
      givesAccess: true,
      pendingPayment: false,
      autoRenewalStatus: 'will_renew',
      status: 'active',
      expirationReason: null,
      entitlements: [{ lookupKey: 'league_management', state: 'active' }],
      entitlementPageIncomplete: false,
      environment: 'sandbox',
      store: 'play_store',
      storeSubscriptionIdentifier: 'GPA.test-1',
      ownership: 'purchased',
      pendingProductStoreIdentifier: null,
      transactions: [{
        id: 'GPA.test-1',
        purchasedAtMs,
        productStoreIdentifier: product.revenueCatProductIdentifier,
        expirationDateMs: expirationMs,
        effectiveExpirationDateMs: expirationMs,
      }],
      ...overrides,
    }],
  };
}

describe('RevenueCat Google reconciliation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the active catalog, normalizes provider evidence, and persists a sanitized result', async () => {
    const calls: string[] = [];
    const getCatalog = vi.fn(async () => {
      calls.push('catalog');
      return catalog();
    });
    const getCustomer = vi.fn(async () => {
      calls.push('provider');
      return snapshot();
    });
    const persistLedger = vi.fn(async (_accountId: string, normalized: NormalizedGoogleCustomer) => {
      calls.push('ledger');
      expect(normalized.subscriptions).toHaveLength(1);
      expect(normalized.subscriptions[0].storeEnvironment).toBe('SANDBOX');
      return { subscriptions: 1, transactionsCreated: 1, periodsCreated: 1 };
    });

    await expect(reconcileRevenueCatGoogleLedger('billing_account-1', {
      appEnvironment: 'local', getCatalog, getCustomer, persistLedger,
    })).resolves.toEqual({
      subscriptionsObserved: 1,
      subscriptionsPersisted: 1,
      transactionsCreated: 1,
      periodsCreated: 1,
      issues: [],
    });
    expect(calls).toEqual(['catalog', 'provider', 'ledger']);
    expect(getCatalog).toHaveBeenCalledWith('PREVIEW');
    expect(getCustomer).toHaveBeenCalledWith('billing_account-1');
    expect(persistLedger).toHaveBeenCalledWith('billing_account-1', expect.any(Object));
    expect(JSON.stringify(loggerMock.info.mock.calls)).not.toContain('billing_account-1');
    expect(JSON.stringify(loggerMock.info.mock.calls)).not.toContain('GPA.test-1');
    expect(JSON.stringify(loggerMock.info.mock.calls)).not.toContain(product.revenueCatProductIdentifier);
  });

  it('maps production independently to the production catalog and store environment', async () => {
    const productionSnapshot = snapshot();
    productionSnapshot.storeEnvironment = 'production';
    productionSnapshot.subscriptions[0].environment = 'production';
    const getCatalog = vi.fn(async () => catalog('PRODUCTION'));
    const persistLedger = vi.fn(async (_accountId: string, normalized: NormalizedGoogleCustomer) => {
      expect(normalized.subscriptions[0].storeEnvironment).toBe('PRODUCTION');
      return { subscriptions: 1, transactionsCreated: 1, periodsCreated: 1 };
    });

    await reconcileRevenueCatGoogleLedger('billing_account-1', {
      appEnvironment: 'production',
      getCatalog,
      getCustomer: vi.fn(async () => productionSnapshot),
      persistLedger,
    });
    expect(getCatalog).toHaveBeenCalledWith('PRODUCTION');
  });

  it('fails before provider I/O when no active catalog is available', async () => {
    const getCustomer = vi.fn();
    const persistLedger = vi.fn();
    await expect(reconcileRevenueCatGoogleLedger('billing_account-1', {
      getCatalog: vi.fn(async (): Promise<BillingCatalogDto> => ({
        available: false, environment: 'PREVIEW', release: null, purchasesEnabled: false,
      })),
      getCustomer,
      persistLedger,
    })).rejects.toMatchObject({ statusCode: 503, code: 'BILLING_CATALOG_UNAVAILABLE' });
    expect(getCustomer).not.toHaveBeenCalled();
    expect(persistLedger).not.toHaveBeenCalled();
  });

  it('accepts an empty canonical snapshot without destructive inference', async () => {
    const persistLedger = vi.fn(async (_accountId: string, normalized: NormalizedGoogleCustomer) => {
      expect(normalized.subscriptions).toEqual([]);
      return { subscriptions: 0, transactionsCreated: 0, periodsCreated: 0 };
    });
    await expect(reconcileRevenueCatGoogleLedger('billing_account-1', {
      getCatalog: vi.fn(async () => catalog()),
      getCustomer: vi.fn(async () => ({ ...snapshot(), subscriptions: [] })),
      persistLedger,
    })).resolves.toMatchObject({
      subscriptionsObserved: 0,
      subscriptionsPersisted: 0,
      transactionsCreated: 0,
      periodsCreated: 0,
    });
  });

  it('reports unsupported Apple evidence without writing provider rows', async () => {
    const appleSnapshot = snapshot('billing_account-1', {
      store: 'app_store',
      storeSubscriptionIdentifier: 'apple-transaction-1',
      transactions: [],
    });
    const persistLedger = vi.fn(async (_accountId: string, normalized: NormalizedGoogleCustomer) => {
      expect(normalized.subscriptions).toEqual([]);
      return { subscriptions: 0, transactionsCreated: 0, periodsCreated: 0 };
    });
    await expect(reconcileRevenueCatGoogleLedger('billing_account-1', {
      getCatalog: vi.fn(async () => catalog()),
      getCustomer: vi.fn(async () => appleSnapshot),
      persistLedger,
    })).resolves.toMatchObject({
      subscriptionsObserved: 1,
      subscriptionsPersisted: 0,
      issues: [{ code: 'UNSUPPORTED_STORE', severity: 'INFO', count: 1 }],
    });
  });

  it('preserves provider retry metadata and known ledger conflicts', async () => {
    const providerError = new RevenueCatProviderError('http_429', true, 5_000, 429);
    await expect(reconcileRevenueCatGoogleLedger('billing_account-1', {
      getCatalog: vi.fn(async () => catalog()),
      getCustomer: vi.fn(async () => { throw providerError; }),
    })).rejects.toBe(providerError);
    expect(loggerMock.warn).toHaveBeenLastCalledWith(expect.objectContaining({
      errorCode: 'http_429', retryable: true, retryAfterMs: 5_000, status: 429,
    }), 'Billing reconciliation failed');

    const conflict = new AppError(409, 'Conflicto seguro', 'BILLING_OWNERSHIP_CONFLICT');
    await expect(reconcileRevenueCatGoogleLedger('billing_account-1', {
      getCatalog: vi.fn(async () => catalog()),
      getCustomer: vi.fn(async () => snapshot()),
      persistLedger: vi.fn(async () => { throw conflict; }),
    })).rejects.toBe(conflict);
  });

  it('sanitizes unexpected failures in errors and logs', async () => {
    const leakedMessage = 'database failure for GPA.secret transaction';
    const failure = reconcileRevenueCatGoogleLedger('billing_account-1', {
      getCatalog: vi.fn(async () => catalog()),
      getCustomer: vi.fn(async () => { throw new Error(leakedMessage); }),
    });
    await expect(failure).rejects.toMatchObject({
      statusCode: 503,
      code: 'BILLING_RECONCILIATION_FAILED',
      message: 'No fue posible reconciliar billing',
    });
    expect(JSON.stringify(loggerMock.error.mock.calls)).not.toContain(leakedMessage);
    expect(JSON.stringify(loggerMock.error.mock.calls)).not.toContain('billing_account-1');
  });
});
