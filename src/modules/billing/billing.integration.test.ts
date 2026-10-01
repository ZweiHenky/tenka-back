import { afterEach, describe, expect, test } from 'vitest';
import { prisma } from '../../config/database';
import { bootstrapBillingAccount, detachBillingAccount, ensureBillingAccount, getBillingState } from './service';
import { activateCatalogRelease, getActiveBillingCatalog } from './catalog';
import { MX_2026_09_V1_CATALOG_MANIFEST } from './manifests/mx-2026-09-v1';
import { normalizeGoogleSubscriptions } from './providerNormalizer';
import { persistNormalizedGoogleLedger } from './providerLedger';
import type { RevenueCatCustomerSnapshot } from './revenueCatSchemas';
import { reconcileRevenueCatGoogleLedger } from './reconciliation';
import { reconcileRevenueCatSandboxForDevelopment } from './manualDevelopmentReconciliation';
import { truncateIntegrationBillingData } from '../../test/integration/cleanup';

const userIds = [
  'it-billing-bootstrap-user',
  'it-billing-constraints-user',
  'it-billing-detach-user',
  'it-billing-public-bootstrap-user',
  'it-billing-ledger-user-a',
  'it-billing-ledger-user-b',
];

async function cleanup(): Promise<void> {
  const releases = await prisma.billingCatalogRelease.findMany({
    where: { version: { startsWith: 'it-billing-' } },
    select: { id: true },
  });
  const releaseIds = releases.map(({ id }) => id);
  await prisma.billingProductCatalog.deleteMany({ where: { catalogReleaseId: { in: releaseIds } } });
  await prisma.billingCatalogRelease.deleteMany({ where: { id: { in: releaseIds } } });

  await prisma.$transaction((tx) => truncateIntegrationBillingData(tx));
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

function catalogRows(catalogReleaseId: string) {
  return MX_2026_09_V1_CATALOG_MANIFEST.products.map((product) => ({
    ...product,
    catalogReleaseId,
  }));
}

function providerSnapshot(billingAccountId: string, options: {
  subscriptionId?: string;
  transactionId?: string;
  effectiveExpirationMs?: number;
} = {}): RevenueCatCustomerSnapshot {
  const subscriptionId = options.subscriptionId ?? 'sub_it_google_1';
  const transactionId = options.transactionId ?? 'GPA.it-ledger-1';
  const purchasedAtMs = Date.parse('2026-09-01T12:00:00Z');
  const expirationMs = options.effectiveExpirationMs ?? Date.parse('2026-10-01T12:00:00Z');
  return {
    customerId: billingAccountId,
    storeEnvironment: 'sandbox',
    observedAt: '2026-09-15T12:00:00.000Z',
    subscriptions: [{
      id: subscriptionId,
      customerId: billingAccountId,
      originalCustomerId: billingAccountId,
      productId: 'prod_it_google',
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
      storeSubscriptionIdentifier: transactionId,
      ownership: 'purchased',
      pendingProductStoreIdentifier: null,
      transactions: [{
        id: transactionId,
        purchasedAtMs,
        productStoreIdentifier: 'tenka_capacity_2:monthly',
        expirationDateMs: expirationMs,
        effectiveExpirationDateMs: expirationMs,
      }],
    }],
  };
}

function normalizedSnapshot(billingAccountId: string, options: {
  subscriptionId?: string;
  transactionId?: string;
  effectiveExpirationMs?: number;
} = {}) {
  return normalizeGoogleSubscriptions({
    snapshot: providerSnapshot(billingAccountId, options),
    expectedBillingAccountId: billingAccountId,
    expectedStoreEnvironment: 'SANDBOX',
    catalogProducts: MX_2026_09_V1_CATALOG_MANIFEST.products,
  });
}

function expiredRenewalSnapshot(billingAccountId: string) {
  const purchasedAtMs = Date.parse('2026-09-17T23:04:00Z');
  const fiveMinutes = 5 * 60 * 1000;
  const transactions = Array.from({ length: 7 }, (_, index) => ({
    id: `GPA.it-renewal-${index}`,
    purchasedAtMs: purchasedAtMs + index * fiveMinutes,
    productStoreIdentifier: 'tenka_capacity_2:monthly',
    expirationDateMs: purchasedAtMs + (index + 1) * fiveMinutes,
    effectiveExpirationDateMs: purchasedAtMs + (index + 1) * fiveMinutes,
  }));
  const latest = transactions.at(-1)!;
  return normalizeGoogleSubscriptions({
    snapshot: {
      customerId: billingAccountId,
      storeEnvironment: 'sandbox',
      observedAt: '2026-09-17T23:40:00.000Z',
      subscriptions: [{
        id: 'sub_it_google_expired',
        customerId: billingAccountId,
        originalCustomerId: billingAccountId,
        productId: 'prod_it_google',
        startsAtMs: purchasedAtMs,
        currentPeriodStartsAtMs: latest.purchasedAtMs,
        currentPeriodEndsAtMs: latest.expirationDateMs,
        endsAtMs: latest.expirationDateMs,
        givesAccess: false,
        pendingPayment: false,
        autoRenewalStatus: 'will_not_renew',
        status: 'expired',
        expirationReason: 'BILLING_ERROR',
        entitlements: [],
        entitlementPageIncomplete: false,
        environment: 'sandbox',
        store: 'play_store',
        storeSubscriptionIdentifier: latest.id,
        ownership: 'purchased',
        pendingProductStoreIdentifier: null,
        transactions,
      }],
    },
    expectedBillingAccountId: billingAccountId,
    expectedStoreEnvironment: 'SANDBOX',
    catalogProducts: MX_2026_09_V1_CATALOG_MANIFEST.products,
  });
}

describe('billing database invariants', () => {
  afterEach(cleanup);

  test('concurrent bootstrap creates one account and one canonical identity', async () => {
    const userId = userIds[0];
    await prisma.user.create({
      data: { id: userId, email: `${userId}@example.test`, rol: 'LIGA' },
    });

    const [first, second] = await Promise.all([
      prisma.$transaction((tx) => ensureBillingAccount(tx, userId)),
      prisma.$transaction((tx) => ensureBillingAccount(tx, userId)),
    ]);

    expect(first.id).toBe(second.id);
    await expect(prisma.billingAccount.count({ where: { userId } })).resolves.toBe(1);
    await expect(prisma.billingProviderIdentity.findMany({
      where: { billingAccountId: first.id },
      select: { kind: true, revenueCatAppUserId: true },
    })).resolves.toEqual([{ kind: 'CANONICAL', revenueCatAppUserId: first.id }]);
  });

  test('public billing bootstrap is idempotent and keeps purchases disabled', async () => {
    const userId = userIds[3];
    await prisma.user.create({
      data: { id: userId, email: `${userId}@example.test`, rol: 'LIGA' },
    });

    const [first, second] = await Promise.all([
      bootstrapBillingAccount(userId),
      bootstrapBillingAccount(userId),
    ]);

    expect(first.billingAccountId).toBe(second.billingAccountId);
    expect(first).toMatchObject({
      role: 'LIGA',
      revenueCatAppUserId: first.billingAccountId,
      effectiveCapacity: 1,
      purchasesEnabled: false,
    });
    await expect(prisma.billingAccount.count({ where: { userId } })).resolves.toBe(1);
    await expect(prisma.billingProviderIdentity.count({
      where: { billingAccount: { userId }, kind: 'CANONICAL', status: 'ACTIVE' },
    })).resolves.toBe(1);
  });

  test('database rejects a mismatched canonical identity and two active free grants', async () => {
    const userId = userIds[1];
    await prisma.user.create({
      data: { id: userId, email: `${userId}@example.test`, rol: 'LIGA' },
    });
    const account = await prisma.$transaction((tx) => ensureBillingAccount(tx, userId));
    const emptyAccount = await prisma.billingAccount.create({
      data: { id: 'it-billing-empty-account', ownerUserIdSnapshot: userId },
    });

    await expect(prisma.billingProviderIdentity.create({
      data: {
        billingAccountId: emptyAccount.id,
        revenueCatAppUserId: 'not-the-account-id',
        kind: 'CANONICAL',
      },
    })).rejects.toThrow();

    const grantData = {
      userId,
      billingAccountId: account.id,
      divisionIdSnapshot: 'division-snapshot',
      divisionNameSnapshot: 'Primera',
      leagueIdSnapshot: 'league-snapshot',
      leagueNameSnapshot: 'Liga',
      source: 'INITIAL_FREE' as const,
    };
    await prisma.freeManagementGrant.create({ data: grantData });
    await expect(prisma.freeManagementGrant.create({
      data: { ...grantData, divisionIdSnapshot: 'division-snapshot-2' },
    })).rejects.toThrow();
  });

  test('detaching and deleting a user preserves retired billing evidence', async () => {
    const userId = userIds[2];
    await prisma.user.create({
      data: { id: userId, email: `${userId}@example.test`, rol: 'LIGA' },
    });
    const account = await prisma.$transaction((tx) => ensureBillingAccount(tx, userId));
    await prisma.freeManagementGrant.create({
      data: {
        userId,
        billingAccountId: account.id,
        divisionIdSnapshot: 'deleted-division',
        divisionNameSnapshot: 'Primera',
        leagueIdSnapshot: 'deleted-league',
        leagueNameSnapshot: 'Liga',
        source: 'INITIAL_FREE',
      },
    });

    await prisma.$transaction(async (tx) => {
      await detachBillingAccount(tx, userId);
      await tx.user.delete({ where: { id: userId } });
    });

    await expect(prisma.billingAccount.findUnique({ where: { id: account.id } })).resolves.toMatchObject({
      userId: null,
      detachedAt: expect.any(Date),
      detachReason: 'ACCOUNT_DELETED',
    });
    await expect(prisma.billingProviderIdentity.findFirst({
      where: { billingAccountId: account.id },
    })).resolves.toMatchObject({ status: 'RETIRED', retiredAt: expect.any(Date) });
    await expect(prisma.freeManagementGrant.findFirst({
      where: { billingAccountId: account.id },
    })).resolves.toMatchObject({ userId: null, endReason: 'ACCOUNT_DELETED', endedAt: expect.any(Date) });
  });

  test('activates and reads only a complete approved catalog without prices', async () => {
    const release = await prisma.billingCatalogRelease.create({
      data: { version: 'it-billing-complete-v1', environment: 'PREVIEW', approvedAt: new Date() },
    });
    await prisma.billingProductCatalog.createMany({ data: catalogRows(release.id) });

    await activateCatalogRelease(release.id);

    const catalog = await getActiveBillingCatalog('PREVIEW');
    expect(catalog).toMatchObject({
      available: true,
      environment: 'PREVIEW',
      release: { id: release.id, version: 'it-billing-complete-v1' },
      purchasesEnabled: false,
    });
    expect(catalog.release?.products).toHaveLength(84);
    expect(catalog.release?.products.every((product) => !('price' in product) && !('currency' in product))).toBe(true);
  });

  test('database rejects malformed variants, duplicate physical products and two active releases', async () => {
    const first = await prisma.billingCatalogRelease.create({
      data: { version: 'it-billing-constraints-v1', environment: 'PREVIEW' },
    });
    const valid = catalogRows(first.id);

    await expect(prisma.billingProductCatalog.create({
      data: { ...valid[0], capacity: 1, logicalProductId: 'tenka_capacity_1', revenueCatOfferingId: 'capacity_1' },
    })).rejects.toThrow();

    await prisma.billingProductCatalog.create({ data: valid[0] });
    const anotherCapacity = valid.find((row) => row.store === 'APPLE' && row.capacity === 3 && row.billingInterval === 'MONTHLY')!;
    await expect(prisma.billingProductCatalog.create({
      data: { ...anotherCapacity, storeProductId: valid[0].storeProductId },
    })).rejects.toThrow();

    await prisma.billingCatalogRelease.update({
      where: { id: first.id },
      data: { status: 'ACTIVE', approvedAt: new Date(), activatedAt: new Date() },
    });
    await expect(prisma.billingCatalogRelease.create({
      data: {
        version: 'it-billing-constraints-v2',
        environment: 'PREVIEW',
        status: 'ACTIVE',
        approvedAt: new Date(),
        activatedAt: new Date(),
      },
    })).rejects.toThrow();
  });

  test('provider ledger persists idempotently and appends a correction revision', async () => {
    const userId = userIds[4];
    await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, rol: 'LIGA' } });
    const account = await prisma.$transaction((tx) => ensureBillingAccount(tx, userId));

    const first = normalizedSnapshot(account.id);
    await expect(persistNormalizedGoogleLedger(account.id, first)).resolves.toEqual({
      subscriptions: 1, transactionsCreated: 1, periodsCreated: 1,
    });
    await expect(persistNormalizedGoogleLedger(account.id, first)).resolves.toEqual({
      subscriptions: 1, transactionsCreated: 0, periodsCreated: 0,
    });

    const corrected = normalizedSnapshot(account.id, {
      effectiveExpirationMs: Date.parse('2026-10-08T12:00:00Z'),
    });
    corrected.observedAt = new Date('2026-09-16T12:00:00Z');
    corrected.subscriptions[0].providerStatusUpdatedAt = corrected.observedAt;
    await expect(persistNormalizedGoogleLedger(account.id, corrected)).resolves.toEqual({
      subscriptions: 1, transactionsCreated: 0, periodsCreated: 1,
    });
    const periods = await prisma.billingProviderPeriod.findMany({
      where: { billingAccountId: account.id }, orderBy: { revision: 'asc' },
    });
    expect(periods).toHaveLength(2);
    expect(periods.map(({ revision }) => revision)).toEqual([1, 2]);
    expect(periods[1].supersedesProviderPeriodId).toBe(periods[0].id);

    const stale = normalizedSnapshot(account.id);
    stale.observedAt = new Date('2026-09-14T12:00:00Z');
    stale.subscriptions[0].providerStatusUpdatedAt = stale.observedAt;
    stale.subscriptions[0].providerStatus = 'EXPIRED';
    stale.subscriptions[0].entitlementActive = false;
    await persistNormalizedGoogleLedger(account.id, stale);
    await expect(prisma.billingProviderSubscription.findFirstOrThrow({
      where: { chain: { billingAccountId: account.id } },
      select: { providerStatus: true, entitlementActive: true, providerStatusUpdatedAt: true },
    })).resolves.toEqual({
      providerStatus: 'ACTIVE',
      entitlementActive: true,
      providerStatusUpdatedAt: new Date('2026-09-16T12:00:00Z'),
    });
    await expect(prisma.billingProviderPeriod.count({ where: { billingAccountId: account.id } }))
      .resolves.toBe(2);
    await expect(prisma.billingProviderPeriod.update({
      where: { id: periods[0].id }, data: { entitlementActive: false },
    })).rejects.toThrow();
  }, 20_000);

  test('provider ledger persists an expired accelerated-renewal chain idempotently', async () => {
    const userId = userIds[4];
    await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, rol: 'LIGA' } });
    const account = await prisma.$transaction((tx) => ensureBillingAccount(tx, userId));
    const normalized = expiredRenewalSnapshot(account.id);

    expect(normalized.issues).toEqual([]);
    await expect(persistNormalizedGoogleLedger(account.id, normalized)).resolves.toEqual({
      subscriptions: 1, transactionsCreated: 7, periodsCreated: 7,
    });
    await expect(persistNormalizedGoogleLedger(account.id, normalized)).resolves.toEqual({
      subscriptions: 1, transactionsCreated: 0, periodsCreated: 0,
    });
    await expect(prisma.billingProviderSubscription.findFirstOrThrow({
      where: { chain: { billingAccountId: account.id } },
      select: { providerStatus: true, entitlementActive: true, providerEndReason: true },
    })).resolves.toEqual({
      providerStatus: 'EXPIRED', entitlementActive: false, providerEndReason: 'BILLING_FAILURE',
    });
  }, 20_000);

  test('internal reconciliation persists canonical evidence idempotently for a detached account', async () => {
    const userId = userIds[4];
    await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, rol: 'LIGA' } });
    const account = await prisma.$transaction((tx) => ensureBillingAccount(tx, userId));
    const release = await prisma.billingCatalogRelease.create({
      data: { version: 'it-billing-reconciliation-v1', environment: 'PREVIEW', approvedAt: new Date() },
    });
    await prisma.billingProductCatalog.createMany({ data: catalogRows(release.id) });
    await activateCatalogRelease(release.id);
    await prisma.$transaction(async (tx) => {
      await detachBillingAccount(tx, userId);
      await tx.user.delete({ where: { id: userId } });
    });

    const dependencies = {
      appEnvironment: 'local' as const,
      getCustomer: async () => providerSnapshot(account.id),
    };
    await expect(reconcileRevenueCatGoogleLedger(account.id, dependencies)).resolves.toMatchObject({
      subscriptionsObserved: 1,
      subscriptionsPersisted: 1,
      transactionsCreated: 1,
      periodsCreated: 1,
      issues: [],
    });
    await expect(reconcileRevenueCatGoogleLedger(account.id, dependencies)).resolves.toMatchObject({
      subscriptionsObserved: 1,
      subscriptionsPersisted: 1,
      transactionsCreated: 0,
      periodsCreated: 0,
      issues: [],
    });
    await expect(prisma.billingAccount.findUniqueOrThrow({
      where: { id: account.id }, select: { userId: true, detachedAt: true },
    })).resolves.toMatchObject({ userId: null, detachedAt: expect.any(Date) });
    await expect(prisma.billingProviderPeriod.count({
      where: { billingAccountId: account.id },
    })).resolves.toBe(1);
  }, 30_000);

  test('protected sandbox reconciliation leaves effective access and purchases disabled', async () => {
    const userId = userIds[5];
    await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, rol: 'LIGA' } });
    const account = await prisma.$transaction((tx) => ensureBillingAccount(tx, userId));
    const release = await prisma.billingCatalogRelease.create({
      data: { version: 'it-billing-manual-reconciliation-v1', environment: 'PREVIEW', approvedAt: new Date() },
    });
    await prisma.billingProductCatalog.createMany({ data: catalogRows(release.id) });
    await activateCatalogRelease(release.id);

    const previousDevelopmentScriptAuth = process.env.DEVELOPMENT_SCRIPT_AUTH;
    process.env.DEVELOPMENT_SCRIPT_AUTH = 'tenka-development-script-v1';
    try {
      await expect(reconcileRevenueCatSandboxForDevelopment(account.id, prisma, {
        getCustomer: async () => providerSnapshot(account.id),
      })).resolves.toMatchObject({
        subscriptionsObserved: 1,
        subscriptionsPersisted: 1,
        transactionsCreated: 1,
        periodsCreated: 1,
      });
    } finally {
      if (previousDevelopmentScriptAuth === undefined) delete process.env.DEVELOPMENT_SCRIPT_AUTH;
      else process.env.DEVELOPMENT_SCRIPT_AUTH = previousDevelopmentScriptAuth;
    }
    await expect(getBillingState(userId)).resolves.toMatchObject({
      billingAccountId: account.id,
      effectiveAccess: 'FREE',
      effectiveCapacity: 1,
      purchasesEnabled: false,
    });
    await expect(getActiveBillingCatalog('PREVIEW')).resolves.toMatchObject({
      available: true,
      purchasesEnabled: false,
    });
  }, 30_000);

  test('provider ledger prevents cross-account ownership and replacement cycles', async () => {
    const firstUserId = userIds[4];
    const secondUserId = userIds[5];
    await prisma.user.createMany({ data: [
      { id: firstUserId, email: `${firstUserId}@example.test`, rol: 'LIGA' },
      { id: secondUserId, email: `${secondUserId}@example.test`, rol: 'LIGA' },
    ] });
    const first = await prisma.$transaction((tx) => ensureBillingAccount(tx, firstUserId));
    const second = await prisma.$transaction((tx) => ensureBillingAccount(tx, secondUserId));
    await persistNormalizedGoogleLedger(first.id, normalizedSnapshot(first.id));

    await expect(persistNormalizedGoogleLedger(second.id, normalizedSnapshot(second.id)))
      .rejects.toMatchObject({ code: 'BILLING_OWNERSHIP_CONFLICT', statusCode: 409 });

    const chain = await prisma.billingProviderSubscriptionChain.findFirstOrThrow({
      where: { billingAccountId: first.id }, select: { id: true },
    });
    const original = await prisma.billingProviderSubscription.findFirstOrThrow({
      where: { providerSubscriptionChainId: chain.id }, select: { id: true },
    });
    const replacement = await prisma.billingProviderSubscription.create({
      data: {
        providerSubscriptionChainId: chain.id,
        store: 'GOOGLE', storeEnvironment: 'SANDBOX', providerSubscriptionKey: 'sub_it_replacement',
        replacesProviderSubscriptionId: original.id,
        providerStatus: 'ACTIVE', providerStatusUpdatedAt: new Date('2026-09-15T12:00:00Z'),
        entitlementActive: true, ownershipType: 'PURCHASED',
      },
    });
    await expect(prisma.billingProviderSubscription.update({
      where: { id: original.id }, data: { replacesProviderSubscriptionId: replacement.id },
    })).rejects.toThrow();
    await expect(prisma.billingAccount.delete({ where: { id: first.id } })).rejects.toThrow();
  });
});
