import { describe, expect, it } from 'vitest';
import { MX_2026_09_V1_CATALOG_MANIFEST } from './manifests/mx-2026-09-v1';
import { normalizeGoogleSubscriptions } from './providerNormalizer';
import type { RevenueCatCustomerSnapshot, RevenueCatSubscriptionSnapshot } from './revenueCatSchemas';

const ACCOUNT_ID = 'billing_account-1';
const OBSERVED_AT = '2026-09-15T12:00:00.000Z';
const PURCHASED_AT = Date.parse('2026-09-01T12:00:00Z');
const EXPIRES_AT = Date.parse('2026-10-01T12:00:00Z');

function subscription(overrides: Partial<RevenueCatSubscriptionSnapshot> = {}): RevenueCatSubscriptionSnapshot {
  return {
    id: 'sub_google_1', customerId: ACCOUNT_ID, originalCustomerId: ACCOUNT_ID,
    productId: 'prod_google_1', startsAtMs: PURCHASED_AT,
    currentPeriodStartsAtMs: PURCHASED_AT, currentPeriodEndsAtMs: EXPIRES_AT, endsAtMs: EXPIRES_AT,
    givesAccess: true, pendingPayment: false, autoRenewalStatus: 'will_renew', status: 'active',
    expirationReason: null,
    entitlements: [{ lookupKey: 'league_management', state: 'active' }], entitlementPageIncomplete: false,
    environment: 'sandbox', store: 'play_store', storeSubscriptionIdentifier: 'GPA.1', ownership: 'purchased',
    pendingProductStoreIdentifier: null,
    transactions: [{
      id: 'GPA.1', purchasedAtMs: PURCHASED_AT,
      productStoreIdentifier: 'tenka_capacity_2:monthly',
      expirationDateMs: EXPIRES_AT, effectiveExpirationDateMs: EXPIRES_AT,
    }],
    ...overrides,
  };
}

function normalize(subscriptions = [subscription()], expectedStoreEnvironment: 'SANDBOX' | 'PRODUCTION' = 'SANDBOX') {
  const snapshot: RevenueCatCustomerSnapshot = {
    customerId: ACCOUNT_ID, storeEnvironment: 'sandbox', observedAt: OBSERVED_AT, subscriptions,
  };
  return normalizeGoogleSubscriptions({
    snapshot, expectedBillingAccountId: ACCOUNT_ID,
    catalogProducts: MX_2026_09_V1_CATALOG_MANIFEST.products,
    expectedStoreEnvironment,
  });
}

describe('Google provider normalizer', () => {
  it.each(MX_2026_09_V1_CATALOG_MANIFEST.products.filter(({ store }) => store === 'GOOGLE'))(
    'maps $revenueCatProductIdentifier without parsing identifiers', (product) => {
      const result = normalize([subscription({
        storeSubscriptionIdentifier: `GPA.${product.capacity}.${product.billingInterval}`,
        transactions: [{
          id: `GPA.${product.capacity}.${product.billingInterval}`,
          purchasedAtMs: PURCHASED_AT,
          productStoreIdentifier: product.revenueCatProductIdentifier,
          expirationDateMs: EXPIRES_AT,
          effectiveExpirationDateMs: EXPIRES_AT,
        }],
      })]);
      expect(result.subscriptions[0].currentProduct).toMatchObject({
        logicalProductId: product.logicalProductId,
        basePlanId: product.basePlanId,
        capacity: product.capacity,
        billingInterval: product.billingInterval,
      });
      expect(result.subscriptions[0].eligibleForNewAccess).toBe(true);
    },
  );

  it.each([
    ['trialing', 'ACTIVE'], ['active', 'ACTIVE'], ['in_grace_period', 'STORE_GRACE'],
    ['in_billing_retry', 'BILLING_RETRY'], ['paused', 'PAUSED'], ['expired', 'EXPIRED'],
    ['account_hold', 'ACCOUNT_HOLD'], ['in_account_hold', 'ACCOUNT_HOLD'], ['revoked', 'REVOKED'],
    ['future_state', 'UNKNOWN'],
  ])('maps provider status %s to %s', (external, expected) => {
    const result = normalize([subscription({ status: external })]);
    expect(result.subscriptions[0].providerStatus).toBe(expected);
  });

  it.each(['in_billing_retry', 'paused'])(
    'keeps %s eligible while canonical entitlement remains active',
    (status) => {
      const result = normalize([subscription({ status })]);
      expect(result.subscriptions[0]).toMatchObject({ entitlementActive: true, eligibleForNewAccess: true });
      expect(result.issues).toEqual([]);
    },
  );

  it('blocks new access while payment is pending without revoking active entitlement', () => {
    const result = normalize([subscription({ pendingPayment: true })]);

    expect(result.subscriptions[0]).toMatchObject({
      entitlementActive: true,
      pendingPayment: true,
      eligibleForContinuedAccess: true,
      eligibleForNewAccess: false,
    });
    expect(result.issues).toEqual([]);
  });

  it.each([
    ['will_renew', true], ['has_already_renewed', true], ['will_change_product', true],
    ['will_not_renew', false], ['will_pause', false], ['requires_price_increase_consent', false],
    ['future_state', null],
  ])('maps renewal state %s', (external, expected) => {
    expect(normalize([subscription({ autoRenewalStatus: external })]).subscriptions[0].willRenew).toBe(expected);
  });

  it('blocks unknown products without creating transactions or periods', () => {
    const result = normalize([subscription({ transactions: [{
      id: 'GPA.1', purchasedAtMs: PURCHASED_AT, productStoreIdentifier: 'unknown:plan',
      expirationDateMs: EXPIRES_AT, effectiveExpirationDateMs: EXPIRES_AT,
    }] })]);
    expect(result.subscriptions[0]).toMatchObject({
      currentProduct: null, eligibleForNewAccess: false, transactions: [], periods: [],
    });
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_PRODUCT', severity: 'BLOCKING' }));
  });

  it.each([
    ['missing entitlement', { entitlements: [] }, 'ENTITLEMENT_MISMATCH'],
    ['family ownership', { ownership: 'family_shared' }, 'UNSAFE_OWNERSHIP'],
    ['customer transfer', { originalCustomerId: 'billing_other' }, 'ORIGINAL_CUSTOMER_MISMATCH'],
    ['wrong environment', { environment: 'production' }, 'ENVIRONMENT_MISMATCH'],
  ])('blocks %s', (_name, overrides, issue) => {
    const result = normalize([subscription(overrides)]);
    expect(result.subscriptions[0].eligibleForNewAccess).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: issue, severity: 'BLOCKING' }));
  });

  it.each([
    ['unknown entitlement state', [{ lookupKey: 'league_management', state: 'future_state' }], true,
      'UNKNOWN_ENTITLEMENT_STATE'],
    ['active entitlement without access', [{ lookupKey: 'league_management', state: 'active' }], false,
      'CONTRADICTORY_PROVIDER_STATE'],
    ['inactive entitlement with access', [{ lookupKey: 'league_management', state: 'inactive' }], true,
      'CONTRADICTORY_PROVIDER_STATE'],
  ] as const)('blocks %s', (_name, entitlements, givesAccess, issue) => {
    const result = normalize([subscription({ entitlements: [...entitlements], givesAccess })]);
    expect(result.subscriptions[0].eligibleForNewAccess).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: issue, severity: 'BLOCKING' }));
  });

  it('normalizes six accelerated renewals followed by billing-error expiration', () => {
    const fiveMinutes = 5 * 60 * 1000;
    const transactions = Array.from({ length: 7 }, (_, index) => ({
      id: `GPA.renewal-${index}`,
      purchasedAtMs: PURCHASED_AT + index * fiveMinutes,
      productStoreIdentifier: 'tenka_capacity_2:monthly',
      expirationDateMs: PURCHASED_AT + (index + 1) * fiveMinutes,
      effectiveExpirationDateMs: PURCHASED_AT + (index + 1) * fiveMinutes,
    }));
    const result = normalize([subscription({
      currentPeriodStartsAtMs: transactions[6].purchasedAtMs,
      currentPeriodEndsAtMs: transactions[6].expirationDateMs,
      endsAtMs: transactions[6].expirationDateMs,
      givesAccess: false,
      autoRenewalStatus: 'will_not_renew',
      status: 'expired',
      expirationReason: 'BILLING_ERROR',
      entitlements: [],
      storeSubscriptionIdentifier: transactions[6].id,
      transactions,
    })]);

    expect(result.issues).toEqual([]);
    expect(result.subscriptions[0]).toMatchObject({
      providerStatus: 'EXPIRED',
      entitlementActive: false,
      eligibleForNewAccess: false,
      eligibleForLocalGrace: true,
      providerEndReason: 'BILLING_FAILURE',
      transactions: expect.arrayContaining([expect.objectContaining({ eventType: 'RENEWAL' })]),
    });
    expect(result.subscriptions[0].transactions).toHaveLength(7);
    expect(result.subscriptions[0].periods).toHaveLength(7);
    expect(result.subscriptions[0].periods.slice(0, -1).every((period) =>
      period.providerStatus === 'EXPIRED'
      && !period.entitlementActive
      && period.providerEndReason === null)).toBe(true);
    expect(result.subscriptions[0].periods.at(-1)).toMatchObject({
      providerStatus: 'EXPIRED', entitlementActive: false, providerEndReason: 'BILLING_FAILURE',
    });
  });

  it('accepts an inactive entitlement association when RevenueCat includes it after expiration', () => {
    const result = normalize([subscription({
      givesAccess: false,
      autoRenewalStatus: 'will_not_renew',
      status: 'expired',
      expirationReason: 'BILLING_ERROR',
      entitlements: [{ lookupKey: 'league_management', state: 'inactive' }],
    })]);

    expect(result.issues).toEqual([]);
    expect(result.subscriptions[0]).toMatchObject({
      entitlementActive: false,
      eligibleForNewAccess: false,
      eligibleForLocalGrace: true,
      providerEndReason: 'BILLING_FAILURE',
    });
  });

  it.each(['in_billing_retry', 'in_grace_period', 'account_hold'])(
    'marks inactive recoverable status %s as local-grace eligible',
    (status) => {
      const result = normalize([subscription({
        status,
        givesAccess: false,
        entitlements: [{ lookupKey: 'league_management', state: 'inactive' }],
      })]);
      expect(result.subscriptions[0]).toMatchObject({
        entitlementActive: false,
        eligibleForContinuedAccess: false,
        eligibleForNewAccess: false,
        eligibleForLocalGrace: true,
      });
    },
  );

  it('keeps Apple as an unsupported issue and does not normalize it as Google', () => {
    const result = normalize([subscription({ store: 'app_store', id: 'sub_apple' })]);
    expect(result.subscriptions).toEqual([]);
    expect(result.issues).toEqual([expect.objectContaining({ code: 'UNSUPPORTED_STORE' })]);
  });

  it('keeps a transaction but not a provider period when dates are missing or invalid', () => {
    const missing = subscription({ transactions: [{
      id: 'GPA.missing', purchasedAtMs: PURCHASED_AT, productStoreIdentifier: 'tenka_capacity_2:monthly',
      expirationDateMs: null, effectiveExpirationDateMs: null,
    }], storeSubscriptionIdentifier: 'GPA.missing' });
    const invalid = subscription({ id: 'sub_google_2', transactions: [{
      id: 'GPA.invalid', purchasedAtMs: EXPIRES_AT, productStoreIdentifier: 'tenka_capacity_2:monthly',
      expirationDateMs: PURCHASED_AT, effectiveExpirationDateMs: PURCHASED_AT,
    }], storeSubscriptionIdentifier: 'GPA.invalid' });
    const result = normalize([missing, invalid]);
    expect(result.subscriptions.every(({ transactions }) => transactions.length === 1)).toBe(true);
    expect(result.subscriptions.every(({ periods }) => periods.length === 0)).toBe(true);
    expect(result.issues.map(({ code }) => code)).toEqual(expect.arrayContaining(['MISSING_PERIOD_DATES', 'INVALID_PERIOD_RANGE']));
  });

  it('uses effective expiration, preserves revisions through changed hashes, and emits deterministic evidence', () => {
    const graceEnd = Date.parse('2026-10-08T12:00:00Z');
    const first = normalize([subscription({ status: 'in_grace_period', transactions: [{
      id: 'GPA.1', purchasedAtMs: PURCHASED_AT, productStoreIdentifier: 'tenka_capacity_2:monthly',
      expirationDateMs: EXPIRES_AT, effectiveExpirationDateMs: graceEnd,
    }] })]);
    const repeated = normalize([subscription({ status: 'in_grace_period', transactions: [{
      id: 'GPA.1', purchasedAtMs: PURCHASED_AT, productStoreIdentifier: 'tenka_capacity_2:monthly',
      expirationDateMs: EXPIRES_AT, effectiveExpirationDateMs: graceEnd,
    }] })]);
    const corrected = normalize([subscription({ status: 'in_grace_period', transactions: [{
      id: 'GPA.1', purchasedAtMs: PURCHASED_AT, productStoreIdentifier: 'tenka_capacity_2:monthly',
      expirationDateMs: EXPIRES_AT, effectiveExpirationDateMs: graceEnd + 1000,
    }] })]);
    expect(first.subscriptions[0].periods[0].providerPeriodEnd.getTime()).toBe(graceEnd);
    expect(first.subscriptions[0].periods[0].dedupeKey).toBe(repeated.subscriptions[0].periods[0].dedupeKey);
    expect(first.subscriptions[0].periods[0].dedupeKey).not.toBe(corrected.subscriptions[0].periods[0].dedupeKey);
  });

  it('warns about multiple active subscriptions without summing capacity', () => {
    const result = normalize([
      subscription(),
      subscription({ id: 'sub_google_2', storeSubscriptionIdentifier: 'GPA.2', transactions: [{
        id: 'GPA.2', purchasedAtMs: PURCHASED_AT, productStoreIdentifier: 'tenka_capacity_5:annual',
        expirationDateMs: EXPIRES_AT, effectiveExpirationDateMs: EXPIRES_AT,
      }] }),
    ]);
    expect(result.subscriptions).toHaveLength(2);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'MULTIPLE_ACTIVE_SUBSCRIPTIONS' }));
  });

  it('contains no prices or PII in normalized output', () => {
    const serialized = JSON.stringify(normalize());
    expect(serialized).not.toContain('price');
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('phone');
  });
});
