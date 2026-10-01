import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { Pool } from 'pg';
import { prisma } from '../../config/database';
import { persistLedgerAndMaterializeStoreAccess } from './effectiveAccessMaterializer';
import { MX_2026_09_V1_CATALOG_MANIFEST } from './manifests/mx-2026-09-v1';
import { normalizeGoogleSubscriptions } from './providerNormalizer';
import type { RevenueCatCustomerSnapshot } from './revenueCatSchemas';
import { ensureBillingAccount, getBillingState } from './service';
import { assignDivisionCapacity, assignDivisionCapacityInTransaction } from './capacityAssignment';
import { truncateIntegrationBillingData } from '../../test/integration/cleanup';
import { resolvePaidAccessShadow } from './paidAccessShadow';
import { persistNormalizedGoogleLedger } from './providerLedger';
import {
  resolveDivisionAccessShadowInTransaction,
  resolveLeagueAccessShadowInTransaction,
} from './resourceAccessShadow';
import { processBillingGraceExpirations } from './billingGraceExpiryWorker';
import { divisionService } from '../division/service';
import { ligaService } from '../liga/service';
import { env } from '../../config/env';
import { getIntegrationPgConnectionString } from '../../test/integration/database';

const USER_ID = 'it-billing-effective-access-user';
const DOMAIN_PREFIX = 'it-billing-effective-access';
const DIVISION_IDS_FOR_TEST = ['a', 'b', 'c'].map((suffix) => `${DOMAIN_PREFIX}-division-${suffix}`);
const FOREIGN_USER_ID = `${DOMAIN_PREFIX}-foreign-user`;
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_NOW = Date.now();
const ACTIVE_PERIOD_START = new Date(TEST_NOW - 30 * DAY_MS);
const ACTIVE_PERIOD_END = new Date(TEST_NOW + 30 * DAY_MS);
const ACTIVE_OBSERVED_AT = new Date(TEST_NOW - DAY_MS);
const RENEWAL_PERIOD_START = new Date(TEST_NOW - 10 * DAY_MS);
const RENEWAL_PERIOD_END = new Date(TEST_NOW + 20 * DAY_MS);
const HISTORICAL_PERIOD_START = new Date(TEST_NOW - 90 * DAY_MS);
const HISTORICAL_PERIOD_END = new Date(TEST_NOW - 60 * DAY_MS);
const RECOVERY_PERIOD_START = ACTIVE_PERIOD_START;
const RECOVERY_PERIOD_END = new Date(TEST_NOW - 15 * DAY_MS);
const CORRECTED_PERIOD_END = new Date(TEST_NOW - 2 * DAY_MS);
let lockObserver: Pool;

async function waitForBlockedAdvisoryLock(timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await lockObserver.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
    );
    if (Number(rows[0].count) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function cleanup() {
  await prisma.$transaction(async (tx) => {
    await truncateIntegrationBillingData(tx);
  });
  await prisma.division.deleteMany({ where: { id: { startsWith: `${DOMAIN_PREFIX}-division-` } } });
  await prisma.liga.deleteMany({ where: { id: `${DOMAIN_PREFIX}-league` } });
  await prisma.ubicacion.deleteMany({ where: { id: `${DOMAIN_PREFIX}-location` } });
  await prisma.categoria.deleteMany({ where: { id: `${DOMAIN_PREFIX}-category` } });
  await prisma.tipo.deleteMany({ where: { id: `${DOMAIN_PREFIX}-type` } });
  await prisma.estadoLiga.deleteMany({ where: { id: `${DOMAIN_PREFIX}-status` } });
  await prisma.tipoCompetencia.deleteMany({ where: { id: `${DOMAIN_PREFIX}-competition` } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.user.deleteMany({ where: { id: FOREIGN_USER_ID } });
}

afterEach(cleanup);
beforeAll(() => { lockObserver = new Pool({ connectionString: getIntegrationPgConnectionString(), max: 1 }); });
afterAll(async () => { await lockObserver.end(); });

function normalizedSnapshot(billingAccountId: string) {
  const purchasedAtMs = ACTIVE_PERIOD_START.getTime();
  const expirationMs = ACTIVE_PERIOD_END.getTime();
  const snapshot: RevenueCatCustomerSnapshot = {
    customerId: billingAccountId,
    storeEnvironment: 'sandbox',
    observedAt: ACTIVE_OBSERVED_AT.toISOString(),
    subscriptions: [{
      id: 'sub_it_effective_access',
      customerId: billingAccountId,
      originalCustomerId: billingAccountId,
      productId: 'prod_it_effective_access',
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
      storeSubscriptionIdentifier: 'GPA.it-effective-access-1',
      ownership: 'purchased',
      pendingProductStoreIdentifier: null,
      transactions: [{
        id: 'GPA.it-effective-access-1',
        purchasedAtMs,
        productStoreIdentifier: 'tenka_capacity_2:monthly',
        expirationDateMs: expirationMs,
        effectiveExpirationDateMs: expirationMs,
      }],
    }],
  };
  return normalizeGoogleSubscriptions({
    snapshot,
    expectedBillingAccountId: billingAccountId,
    expectedStoreEnvironment: 'SANDBOX',
    catalogProducts: MX_2026_09_V1_CATALOG_MANIFEST.products,
  });
}

function revisedCommercialEvidence(
  normalized: ReturnType<typeof normalizedSnapshot>,
  input: {
    capacity: number;
    transactionId: string;
    periodStart: string;
    periodEnd: string;
    providerPeriodKey?: string;
    providerStatusUpdatedAt?: string;
  },
) {
  const revised = structuredClone(normalized);
  const subscription = revised.subscriptions[0];
  const product = MX_2026_09_V1_CATALOG_MANIFEST.products.find(({ store, capacity, billingInterval }) =>
    store === 'GOOGLE' && capacity === input.capacity && billingInterval === 'MONTHLY');
  if (!product) throw new Error('Missing integration catalog product');
  const purchasedAt = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);
  subscription.providerStatusUpdatedAt = new Date(input.providerStatusUpdatedAt ?? Date.now());
  subscription.providerAccessEndsAt = periodEnd;
  subscription.currentProduct = { ...product };
  subscription.canonicalEvidenceReference = `subscription-${input.transactionId}`;
  subscription.transactions.push({
    providerTransactionId: input.transactionId,
    eventType: 'RENEWAL',
    logicalProductId: product.logicalProductId,
    storeProductId: product.storeProductId,
    basePlanId: product.basePlanId!,
    capacity: product.capacity,
    billingInterval: product.billingInterval,
    purchasedAt,
  });
  subscription.periods.push({
    providerPeriodKey: input.providerPeriodKey ?? input.transactionId,
    dedupeKey: `period-${input.transactionId}`,
    providerTransactionId: input.transactionId,
    logicalProductId: product.logicalProductId,
    storeProductId: product.storeProductId,
    basePlanId: product.basePlanId!,
    capacity: product.capacity,
    billingInterval: product.billingInterval,
    providerPeriodStart: purchasedAt,
    providerPeriodEnd: periodEnd,
    providerStatus: 'ACTIVE',
    entitlementActive: true,
    providerEndReason: null,
    canonicalEvidenceReference: `evidence-${input.transactionId}`,
  });
  return revised;
}

function failedBillingEvidence(
  normalized: ReturnType<typeof normalizedSnapshot>,
  accessEnd: Date,
) {
  const failed = structuredClone(normalized);
  const subscription = failed.subscriptions[0];
  subscription.providerStatus = 'EXPIRED';
  subscription.providerStatusUpdatedAt = new Date();
  subscription.entitlementActive = false;
  subscription.eligibleForContinuedAccess = false;
  subscription.eligibleForNewAccess = false;
  subscription.eligibleForLocalGrace = true;
  subscription.providerEndReason = 'BILLING_FAILURE';
  subscription.providerAccessEndsAt = accessEnd;
  subscription.canonicalEvidenceReference = `failed-${accessEnd.toISOString()}`;
  const latestPeriod = subscription.periods.at(-1)!;
  latestPeriod.providerPeriodEnd = accessEnd;
  latestPeriod.providerStatus = 'EXPIRED';
  latestPeriod.entitlementActive = false;
  latestPeriod.providerEndReason = 'BILLING_FAILURE';
  latestPeriod.dedupeKey = `failed-${accessEnd.toISOString()}`;
  latestPeriod.canonicalEvidenceReference = `failed-period-${accessEnd.toISOString()}`;
  return failed;
}

function voluntarilyExpiredEvidence(
  normalized: ReturnType<typeof normalizedSnapshot>,
  accessEnd: Date,
) {
  const expired = structuredClone(normalized);
  const subscription = expired.subscriptions[0];
  subscription.providerStatus = 'EXPIRED';
  subscription.providerStatusUpdatedAt = new Date();
  subscription.entitlementActive = false;
  subscription.eligibleForContinuedAccess = false;
  subscription.eligibleForNewAccess = false;
  subscription.eligibleForLocalGrace = false;
  subscription.providerEndReason = 'VOLUNTARY';
  subscription.providerAccessEndsAt = accessEnd;
  subscription.canonicalEvidenceReference = `voluntary-${accessEnd.toISOString()}`;
  const latestPeriod = subscription.periods.at(-1)!;
  latestPeriod.providerPeriodEnd = accessEnd;
  latestPeriod.providerStatus = 'EXPIRED';
  latestPeriod.entitlementActive = false;
  latestPeriod.providerEndReason = 'VOLUNTARY';
  latestPeriod.dedupeKey = `voluntary-${accessEnd.toISOString()}`;
  latestPeriod.canonicalEvidenceReference = `voluntary-period-${accessEnd.toISOString()}`;
  return expired;
}

async function setup() {
  await prisma.user.create({ data: { id: USER_ID, email: `${USER_ID}@example.test`, rol: 'LIGA' } });
  const account = await prisma.$transaction((tx) => ensureBillingAccount(tx, USER_ID));
  return { account, normalized: normalizedSnapshot(account.id) };
}

async function createDivisions() {
  await prisma.ubicacion.create({
    data: { id: `${DOMAIN_PREFIX}-location`, lat: 0, lng: 0, nombreCompleto: 'Test', estado: 'Test', municipio: 'Test', timeZone: 'UTC' },
  });
  await prisma.liga.create({
    data: {
      id: `${DOMAIN_PREFIX}-league`, nombre: 'Liga billing', nombreNormalizado: DOMAIN_PREFIX,
      descripcion: 'Test', userId: USER_ID, ubicacionId: `${DOMAIN_PREFIX}-location`,
    },
  });
  await Promise.all([
    prisma.categoria.create({ data: { id: `${DOMAIN_PREFIX}-category`, nombre: 'Billing Test' } }),
    prisma.tipo.create({ data: { id: `${DOMAIN_PREFIX}-type`, nombre: 'Billing Test' } }),
    prisma.estadoLiga.create({ data: { id: `${DOMAIN_PREFIX}-status`, nombre: 'Billing Test', codigo: 'EN_CURSO' } }),
    prisma.tipoCompetencia.create({ data: { id: `${DOMAIN_PREFIX}-competition`, nombre: 'Billing Test', codigo: 'LIGA_Y_ELIMINATORIAS' } }),
  ]);
  for (const suffix of ['a', 'b', 'c']) {
    await prisma.division.create({
      data: {
        id: `${DOMAIN_PREFIX}-division-${suffix}`, nombre: `Division ${suffix}`, maxEquipos: 8,
        ligaId: `${DOMAIN_PREFIX}-league`, categoriaId: `${DOMAIN_PREFIX}-category`,
        tipoId: `${DOMAIN_PREFIX}-type`, estadoLigaId: `${DOMAIN_PREFIX}-status`,
        tipoCompetenciaId: `${DOMAIN_PREFIX}-competition`,
      },
    });
  }
}

async function createExpiredHistoricalPeriod(billingAccountId: string) {
  const chain = await prisma.billingProviderSubscriptionChain.create({
    data: {
      billingAccountId, store: 'GOOGLE',
      providerChainReference: 'it-effective-access-expired-chain',
    },
  });
  const subscription = await prisma.billingProviderSubscription.create({
    data: {
      providerSubscriptionChainId: chain.id, store: 'GOOGLE', storeEnvironment: 'SANDBOX',
      providerSubscriptionKey: 'it-effective-access-expired-subscription', providerStatus: 'EXPIRED',
      providerStatusUpdatedAt: HISTORICAL_PERIOD_END, entitlementActive: false,
      providerAccessEndsAt: HISTORICAL_PERIOD_END, willRenew: false,
      currentLogicalProductId: 'tenka_capacity_2', currentStoreProductId: 'tenka_capacity_2',
      currentBasePlanId: 'monthly', currentCapacity: 2, currentBillingInterval: 'MONTHLY',
      ownershipType: 'PURCHASED',
    },
  });
  const transaction = await prisma.billingTransaction.create({
    data: {
      billingAccountId, providerSubscriptionId: subscription.id, store: 'GOOGLE', storeEnvironment: 'SANDBOX',
      providerTransactionId: 'GPA.it-effective-access-expired', eventType: 'INITIAL_PURCHASE',
      logicalProductId: 'tenka_capacity_2', storeProductId: 'tenka_capacity_2', basePlanId: 'monthly',
      capacity: 2, billingInterval: 'MONTHLY', purchasedAt: HISTORICAL_PERIOD_START,
    },
  });
  const providerPeriod = await prisma.billingProviderPeriod.create({
    data: {
      billingAccountId, providerSubscriptionId: subscription.id, billingTransactionId: transaction.id,
      store: 'GOOGLE', storeEnvironment: 'SANDBOX', providerPeriodKey: 'it-effective-access-expired-period',
      dedupeKey: 'it-effective-access-expired-period', logicalProductId: 'tenka_capacity_2',
      storeProductId: 'tenka_capacity_2', basePlanId: 'monthly', capacity: 2, billingInterval: 'MONTHLY',
      providerPeriodStart: HISTORICAL_PERIOD_START,
      providerPeriodEnd: HISTORICAL_PERIOD_END, providerStatus: 'EXPIRED', entitlementActive: false,
    },
  });
  return prisma.billingPeriod.create({
    data: {
      billingAccountId, materializationKey: 'it-effective-access-expired-materialization',
      logicalProductIdSnapshot: 'tenka_capacity_2', capacityAtStart: 2, billingIntervalAtStart: 'MONTHLY',
      effectiveStart: HISTORICAL_PERIOD_START, effectiveEnd: HISTORICAL_PERIOD_END,
      providerStartedAt: HISTORICAL_PERIOD_START, primaryProviderPeriodId: providerPeriod.id,
      enforcedAt: HISTORICAL_PERIOD_START,
      providerSources: { create: { billingProviderPeriodId: providerPeriod.id, isPrimary: true } },
      assignments: {
        create: {
          slotNumber: 2, divisionId: `${DOMAIN_PREFIX}-division-a`,
          divisionIdSnapshot: `${DOMAIN_PREFIX}-division-a`, divisionNameSnapshot: 'Division a',
          leagueIdSnapshot: `${DOMAIN_PREFIX}-league`, leagueNameSnapshot: 'Liga billing',
          ownerUserIdSnapshot: USER_ID, assignedAt: HISTORICAL_PERIOD_START,
          assignmentSource: 'DIRECT',
        },
      },
    },
  });
}

describe('effective billing access foundation', () => {
  test('starts local grace idempotently and recovers into a new immutable period', async () => {
    const { account, normalized } = await setup();
    await createDivisions();
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);
    const initialPeriod = await prisma.billingPeriod.findFirstOrThrow({ where: { billingAccountId: account.id } });

    const initialAssignment = await prisma.divisionCapacityAssignment.findFirstOrThrow({
      where: { billingPeriodId: initialPeriod.id },
      orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
    });
    const graceStartedAt = initialAssignment.assignedAt;
    const failed = failedBillingEvidence(normalized, graceStartedAt);
    await persistLedgerAndMaterializeStoreAccess(account.id, failed);
    const firstGrace = await prisma.billingLocalGrace.findFirstOrThrow({ where: { billingAccountId: account.id } });
    await persistLedgerAndMaterializeStoreAccess(account.id, failed);
    const repeatedGrace = await prisma.billingLocalGrace.findFirstOrThrow({ where: { billingAccountId: account.id } });
    expect(repeatedGrace).toMatchObject({
      id: firstGrace.id,
      status: 'ACTIVE',
      startedAt: graceStartedAt,
      endsAt: firstGrace.endsAt,
    });
    await expect(resolvePaidAccessShadow(account.id)).resolves.toMatchObject({
      state: 'LOCAL_GRACE',
      capacity: 2,
      assignments: expect.arrayContaining([
        expect.objectContaining({ divisionId: `${DOMAIN_PREFIX}-division-a` }),
      ]),
    });

    const recovered = structuredClone(normalized);
    recovered.observedAt = new Date(Date.now() + 1_000);
    recovered.subscriptions[0].providerStatusUpdatedAt = recovered.observedAt;
    recovered.subscriptions[0].canonicalEvidenceReference = 'recovered-subscription';
    recovered.subscriptions[0].periods[0].dedupeKey = 'recovered-period';
    recovered.subscriptions[0].periods[0].canonicalEvidenceReference = 'recovered-period-evidence';
    await persistLedgerAndMaterializeStoreAccess(account.id, recovered);

    expect(await prisma.billingLocalGrace.findUnique({ where: { id: firstGrace.id } })).toMatchObject({
      status: 'RECOVERED',
      recoveryBillingPeriodId: expect.any(String),
    });
    expect(await prisma.billingPeriod.count({ where: { billingAccountId: account.id } })).toBe(2);
    const recoveryPeriod = await prisma.billingPeriod.findFirstOrThrow({
      where: { billingAccountId: account.id, id: { not: initialPeriod.id } },
      include: { assignments: true },
    });
    expect(recoveryPeriod.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        divisionId: `${DOMAIN_PREFIX}-division-a`,
        slotNumber: 1,
        assignmentSource: 'GRACE_RECOVERY',
      }),
    ]));
    expect(recoveryPeriod.assignments).toHaveLength(2);
  }, 45_000);

  test('expires due local grace into one idempotent free grant', async () => {
    const { account, normalized } = await setup();
    await createDivisions();
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);
    const period = await prisma.billingPeriod.findFirstOrThrow({ where: { billingAccountId: account.id } });
    const startedAt = new Date(period.effectiveStart.getTime() + 1);
    const endsAt = startedAt;
    await prisma.billingPeriod.update({
      where: { id: period.id },
      data: { endedEarlyAt: startedAt, endReason: 'PROVIDER_CORRECTION', providerEndedAt: startedAt },
    });
    const grace = await prisma.billingLocalGrace.create({
      data: {
        billingAccountId: account.id,
        sourceBillingPeriodId: period.id,
        incidentKey: 'integration-expired-grace',
        reason: 'BILLING_FAILURE',
        startedAt,
        endsAt,
      },
    });

    await processBillingGraceExpirations();
    await processBillingGraceExpirations();

    expect(await prisma.billingLocalGrace.findUnique({ where: { id: grace.id } })).toMatchObject({
      status: 'EXPIRED',
      expiredAt: expect.any(Date),
    });
    expect(await prisma.freeManagementGrant.findMany({ where: { sourceLocalGraceId: grace.id } })).toEqual([
      expect.objectContaining({
        source: 'PAID_EXPIRATION',
        divisionId: `${DOMAIN_PREFIX}-division-a`,
      }),
    ]);
  }, 45_000);

  test('materializes one free grant after expiration without local grace', async () => {
    const { account, normalized } = await setup();
    await createDivisions();
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);

    const expired = voluntarilyExpiredEvidence(normalized, new Date(Date.now() - 1_000));
    await persistLedgerAndMaterializeStoreAccess(account.id, expired);
    await persistLedgerAndMaterializeStoreAccess(account.id, expired);

    const grants = await prisma.freeManagementGrant.findMany({
      where: { billingAccountId: account.id, endedAt: null },
    });
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      source: 'PAID_EXPIRATION',
      divisionId: expect.stringMatching(`${DOMAIN_PREFIX}-division-[ab]`),
      sourceLocalGraceId: null,
    });
    expect(await prisma.billingLocalGrace.count({ where: { billingAccountId: account.id } })).toBe(0);
    await expect(resolvePaidAccessShadow(account.id)).resolves.toMatchObject({ state: 'NONE' });
    const fallbackId = grants[0].divisionId!;
    const readOnlyId = DIVISION_IDS_FOR_TEST.find((id) => id !== fallbackId)!;
    const actor = { id: USER_ID, email: `${USER_ID}@example.test`, rol: 'LIGA' as const };
    const previousEnforcement = env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED;
    env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED = true;
    try {
      await expect(divisionService.update(fallbackId, { nombre: 'Fallback editable' }, actor))
        .resolves.toMatchObject({ nombre: 'Fallback editable' });
      await expect(divisionService.update(readOnlyId, { nombre: 'Fallback bloqueada' }, actor))
        .rejects.toMatchObject({ code: 'BILLING_RESOURCE_READ_ONLY' });
    } finally {
      env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED = previousEnforcement;
    }
  }, 45_000);

  test('materializes one period idempotently without changing public access', async () => {
    const { account, normalized } = await setup();

    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);

    expect(await prisma.billingPeriod.count({ where: { billingAccountId: account.id } })).toBe(1);
    expect(await prisma.billingPeriodSource.count({
      where: { billingPeriod: { billingAccountId: account.id }, isPrimary: true },
    })).toBe(1);
    await expect(resolvePaidAccessShadow(account.id)).resolves.toEqual({
      state: 'PAID', capacity: 2, assignments: [],
    });
    expect(await getBillingState(USER_ID)).toMatchObject({
      effectiveAccess: 'FREE', effectiveCapacity: 1, purchasesEnabled: false,
    });
  }, 30_000);

  test('converts the initial free grant into paid slot one atomically and idempotently', async () => {
    const { account, normalized } = await setup();
    await createDivisions();
    const grant = await prisma.freeManagementGrant.create({
      data: {
        userId: USER_ID,
        billingAccountId: account.id,
        divisionId: `${DOMAIN_PREFIX}-division-a`,
        divisionIdSnapshot: `${DOMAIN_PREFIX}-division-a`,
        divisionNameSnapshot: 'Division historica',
        leagueId: `${DOMAIN_PREFIX}-league`,
        leagueIdSnapshot: `${DOMAIN_PREFIX}-league`,
        leagueNameSnapshot: 'Liga historica',
        source: 'INITIAL_FREE',
      },
    });

    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);

    const period = await prisma.billingPeriod.findFirstOrThrow({
      where: { billingAccountId: account.id },
      include: { assignments: true },
    });
    expect(period.assignments).toHaveLength(2);
    const freeAssignment = period.assignments.find(({ assignmentSource }) => assignmentSource === 'FREE_CONVERSION')!;
    expect(freeAssignment).toMatchObject({
      slotNumber: 1,
      divisionId: `${DOMAIN_PREFIX}-division-a`,
      divisionIdSnapshot: `${DOMAIN_PREFIX}-division-a`,
      divisionNameSnapshot: 'Division historica',
      leagueNameSnapshot: 'Liga historica',
      assignmentSource: 'FREE_CONVERSION',
    });
    await expect(prisma.freeManagementGrant.findUniqueOrThrow({ where: { id: grant.id } }))
      .resolves.toMatchObject({
        endReason: 'PAID_CONVERSION',
        endedAt: expect.any(Date),
        convertedToBillingPeriodId: period.id,
        convertedToAssignmentId: freeAssignment.id,
      });
    expect(await prisma.billingAuditLog.count({
      where: { action: 'BILLING_DIVISION_ASSIGNED', targetId: freeAssignment.id },
    })).toBe(1);
    await expect(getBillingState(USER_ID)).resolves.toMatchObject({
      effectiveAccess: 'FREE', effectiveCapacity: 1, freeManagementGrant: null, purchasesEnabled: false,
    });
    await expect(resolvePaidAccessShadow(account.id)).resolves.toMatchObject({
      state: 'PAID', capacity: 2,
      assignments: [
        expect.objectContaining({ slotNumber: 1, divisionIdSnapshot: `${DOMAIN_PREFIX}-division-a` }),
        expect.objectContaining({ slotNumber: 2, divisionIdSnapshot: `${DOMAIN_PREFIX}-division-b` }),
      ],
    });
    await expect(prisma.$transaction((tx) => resolveDivisionAccessShadowInTransaction(tx, {
      divisionId: `${DOMAIN_PREFIX}-division-a`, actor: { id: USER_ID, rol: 'LIGA' },
    }))).resolves.toMatchObject({ access: 'FULL', reason: 'PAID_ASSIGNED' });
    await expect(prisma.$transaction((tx) => resolveDivisionAccessShadowInTransaction(tx, {
      divisionId: `${DOMAIN_PREFIX}-division-b`, actor: { id: USER_ID, rol: 'LIGA' },
    }))).resolves.toMatchObject({ access: 'FULL', reason: 'PAID_ASSIGNED' });
    await expect(prisma.$transaction((tx) => resolveLeagueAccessShadowInTransaction(tx, {
      leagueId: `${DOMAIN_PREFIX}-league`, actor: { id: USER_ID, rol: 'LIGA' }, resourceType: 'SHARED_RESOURCE',
    }))).resolves.toMatchObject({ access: 'READ_ONLY', reason: 'SHARED_RESOURCE_LOCKED' });
  }, 30_000);

  test('consumes a locked initial selection and verifies its checkout exactly once', async () => {
    const { account, normalized } = await setup();
    await createDivisions();
    await prisma.freeManagementGrant.create({
      data: {
        userId: USER_ID, billingAccountId: account.id,
        divisionId: `${DOMAIN_PREFIX}-division-a`, divisionIdSnapshot: `${DOMAIN_PREFIX}-division-a`,
        divisionNameSnapshot: 'Division historica', leagueId: `${DOMAIN_PREFIX}-league`,
        leagueIdSnapshot: `${DOMAIN_PREFIX}-league`, leagueNameSnapshot: 'Liga historica',
        source: 'INITIAL_FREE',
      },
    });
    const selection = await prisma.billingPurchaseSelection.create({
      data: {
        billingAccountId: account.id, logicalProductId: 'tenka_capacity_2',
        billingInterval: 'MONTHLY', targetCapacity: 2,
        items: { createMany: { data: [
          { slotNumber: 1, divisionIdSnapshot: `${DOMAIN_PREFIX}-division-a` },
          { slotNumber: 2, divisionIdSnapshot: `${DOMAIN_PREFIX}-division-b` },
        ] } },
      },
    });
    const attempt = await prisma.billingCheckoutAttempt.create({
      data: {
        billingAccountId: account.id, purchaseSelectionId: selection.id, store: 'GOOGLE',
        catalogReleaseIdSnapshot: 'integration-release', logicalProductIdSnapshot: 'tenka_capacity_2',
        billingIntervalSnapshot: 'MONTHLY', targetCapacitySnapshot: 2,
        offeringIdSnapshot: 'capacity_2', packageIdSnapshot: '$rc_monthly',
        storeProductIdSnapshot: 'tenka_capacity_2', basePlanIdSnapshot: 'monthly',
        idempotencyKey: 'selection-checkout-1', requestFingerprint: 'a'.repeat(64), startedAt: new Date(),
      },
    });
    await prisma.billingPurchaseSelection.update({
      where: { id: selection.id },
      data: {
        status: 'LOCKED', lockedAt: new Date(), checkoutAttemptId: attempt.id,
        version: { increment: 1 },
      },
    });
    await prisma.billingVerification.create({
      data: {
        billingAccountId: account.id, checkoutAttemptId: attempt.id, store: 'GOOGLE',
        idempotencyKey: 'selection-verify-1', requestFingerprint: 'b'.repeat(64), requestedAt: new Date(),
      },
    });

    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);

    const assignments = await prisma.divisionCapacityAssignment.findMany({
      where: { billingPeriod: { billingAccountId: account.id } }, orderBy: { slotNumber: 'asc' },
    });
    expect(assignments.map(({ slotNumber, divisionIdSnapshot, assignmentSource }) => ({
      slotNumber, divisionIdSnapshot, assignmentSource,
    }))).toEqual([
      { slotNumber: 1, divisionIdSnapshot: `${DOMAIN_PREFIX}-division-a`, assignmentSource: 'FREE_CONVERSION' },
      { slotNumber: 2, divisionIdSnapshot: `${DOMAIN_PREFIX}-division-b`, assignmentSource: 'PURCHASE_SELECTION' },
    ]);
    await expect(prisma.billingPurchaseSelection.findUniqueOrThrow({ where: { id: selection.id } }))
      .resolves.toMatchObject({ status: 'APPLIED', version: 3, consumedByPeriodId: expect.any(String) });
    await expect(prisma.billingCheckoutAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
      .resolves.toMatchObject({ status: 'VERIFIED', version: 2, terminalAt: expect.any(Date) });
    await expect(prisma.billingVerification.findUniqueOrThrow({ where: { checkoutAttemptId: attempt.id } }))
      .resolves.toMatchObject({ status: 'VERIFIED', attemptCount: 1, verifiedAt: expect.any(Date) });
  }, 30_000);

  test('consumes an empty repurchase selection after expiration without rolling historical assignments', async () => {
    const { account, normalized } = await setup();
    await createDivisions();
    const historicalPeriod = await createExpiredHistoricalPeriod(account.id);
    const selection = await prisma.billingPurchaseSelection.create({
      data: {
        billingAccountId: account.id, logicalProductId: 'tenka_capacity_2',
        billingInterval: 'MONTHLY', targetCapacity: 2,
      },
    });
    const attempt = await prisma.billingCheckoutAttempt.create({
      data: {
        billingAccountId: account.id, purchaseSelectionId: selection.id, store: 'GOOGLE',
        catalogReleaseIdSnapshot: 'integration-release', logicalProductIdSnapshot: 'tenka_capacity_2',
        billingIntervalSnapshot: 'MONTHLY', targetCapacitySnapshot: 2,
        offeringIdSnapshot: 'capacity_2', packageIdSnapshot: '$rc_monthly',
        storeProductIdSnapshot: 'tenka_capacity_2', basePlanIdSnapshot: 'monthly',
        idempotencyKey: 'repurchase-checkout-1', requestFingerprint: 'c'.repeat(64), startedAt: new Date(),
        status: 'VERIFICATION_PENDING',
      },
    });
    await prisma.billingPurchaseSelection.update({
      where: { id: selection.id },
      data: {
        status: 'LOCKED', lockedAt: new Date(), checkoutAttemptId: attempt.id,
        version: { increment: 1 },
      },
    });
    await prisma.billingVerification.create({
      data: {
        billingAccountId: account.id, checkoutAttemptId: attempt.id, store: 'GOOGLE',
        idempotencyKey: 'repurchase-verify-1', requestFingerprint: 'd'.repeat(64), requestedAt: new Date(),
      },
    });

    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);

    const periods = await prisma.billingPeriod.findMany({
      where: { billingAccountId: account.id }, orderBy: { effectiveStart: 'asc' },
      include: { assignments: true },
    });
    expect(periods).toHaveLength(2);
    expect(periods[0]).toMatchObject({ id: historicalPeriod.id });
    expect(periods[0].assignments).toHaveLength(1);
    expect(periods[1]).toMatchObject({ renewalOfPeriodId: null });
    expect(periods[1].assignments).toEqual([]);
    await expect(prisma.billingPurchaseSelection.findUniqueOrThrow({ where: { id: selection.id } }))
      .resolves.toMatchObject({ status: 'APPLIED', version: 3, consumedByPeriodId: periods[1].id });
    await expect(prisma.billingCheckoutAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
      .resolves.toMatchObject({ status: 'VERIFIED', version: 2, terminalAt: expect.any(Date) });
    await expect(prisma.billingVerification.findUniqueOrThrow({ where: { checkoutAttemptId: attempt.id } }))
      .resolves.toMatchObject({ status: 'VERIFIED', attemptCount: 1, verifiedAt: expect.any(Date) });
    expect(await prisma.billingAuditLog.count({
      where: { action: 'BILLING_CHECKOUT_ATTEMPT_COMPLETED', targetId: attempt.id },
    })).toBe(1);
  }, 30_000);

  test('recovers an expired checkout whose period was materialized before its selection was consumed', async () => {
    const { account, normalized } = await setup();
    await createDivisions();
    await createExpiredHistoricalPeriod(account.id);
    const startedAt = new Date(RECOVERY_PERIOD_START.getTime() - 60_000);
    const expiredEvidence = structuredClone(normalized);
    expiredEvidence.subscriptions[0].providerStatus = 'EXPIRED';
    expiredEvidence.subscriptions[0].entitlementActive = false;
    expiredEvidence.subscriptions[0].eligibleForNewAccess = false;
    expiredEvidence.subscriptions[0].providerAccessEndsAt = RECOVERY_PERIOD_END;
    expiredEvidence.subscriptions[0].periods[0].providerPeriodStart = RECOVERY_PERIOD_START;
    expiredEvidence.subscriptions[0].periods[0].providerPeriodEnd = RECOVERY_PERIOD_END;
    expiredEvidence.subscriptions[0].periods[0].providerStatus = 'EXPIRED';
    expiredEvidence.subscriptions[0].periods[0].entitlementActive = false;
    await persistNormalizedGoogleLedger(account.id, expiredEvidence);
    const providerPeriod = await prisma.billingProviderPeriod.findFirstOrThrow({
      where: {
        billingAccountId: account.id,
        providerPeriodKey: expiredEvidence.subscriptions[0].periods[0].providerPeriodKey,
      },
      include: { subscription: { include: { chain: true } }, transaction: true },
    });
    const selection = await prisma.billingPurchaseSelection.create({
      data: {
        billingAccountId: account.id, logicalProductId: 'tenka_capacity_2',
        billingInterval: 'MONTHLY', targetCapacity: 2,
      },
    });
    const attempt = await prisma.billingCheckoutAttempt.create({
      data: {
        billingAccountId: account.id, purchaseSelectionId: selection.id, store: 'GOOGLE',
        catalogReleaseIdSnapshot: 'integration-release', logicalProductIdSnapshot: 'tenka_capacity_2',
        billingIntervalSnapshot: 'MONTHLY', targetCapacitySnapshot: 2,
        offeringIdSnapshot: 'capacity_2', packageIdSnapshot: '$rc_monthly',
        storeProductIdSnapshot: 'tenka_capacity_2', basePlanIdSnapshot: 'monthly',
        idempotencyKey: 'historical-recovery-checkout', requestFingerprint: 'e'.repeat(64),
        startedAt, status: 'VERIFICATION_PENDING', nextVerificationAt: startedAt,
      },
    });
    await prisma.billingPurchaseSelection.update({
      where: { id: selection.id },
      data: { status: 'LOCKED', lockedAt: startedAt, checkoutAttemptId: attempt.id, version: { increment: 1 } },
    });
    await prisma.billingVerification.create({
      data: {
        billingAccountId: account.id, checkoutAttemptId: attempt.id, store: 'GOOGLE',
        idempotencyKey: 'historical-recovery-verification', requestFingerprint: 'f'.repeat(64),
        requestedAt: startedAt,
      },
    });
    const materializedPeriod = await prisma.billingPeriod.create({
      data: {
        billingAccountId: account.id, materializationKey: 'historical-recovery-period',
        logicalProductIdSnapshot: 'tenka_capacity_2', capacityAtStart: 2,
        billingIntervalAtStart: 'MONTHLY', effectiveStart: new Date(RECOVERY_PERIOD_START.getTime() + 30_000),
        effectiveEnd: RECOVERY_PERIOD_END, providerStartedAt: RECOVERY_PERIOD_START,
        primaryProviderPeriodId: providerPeriod.id, renewalOfPeriodId: null,
        enforcedAt: new Date(RECOVERY_PERIOD_START.getTime() + 30_000),
        providerSources: { create: { billingProviderPeriodId: providerPeriod.id, isPrimary: true } },
        assignments: {
          create: {
            slotNumber: 2, divisionId: `${DOMAIN_PREFIX}-division-a`,
            divisionIdSnapshot: `${DOMAIN_PREFIX}-division-a`, divisionNameSnapshot: 'Division a',
            leagueIdSnapshot: `${DOMAIN_PREFIX}-league`, leagueNameSnapshot: 'Liga billing',
            ownerUserIdSnapshot: USER_ID, assignedAt: new Date(RECOVERY_PERIOD_START.getTime() + 30_000),
            assignmentSource: 'PERIOD_ROLLOVER',
          },
        },
      },
    });
    await prisma.billingAuditLog.create({
      data: {
        action: 'BILLING_PERIOD_MATERIALIZED', actorType: 'SYSTEM',
        actorUserIdSnapshot: 'billing-reconciliation', targetType: 'BillingPeriod',
        targetId: materializedPeriod.id, requestId: 'historical-recovery-audit',
        metadataRedacted: {
          capacity: 2, sourceCount: 1, rolloverAssignmentCount: 1,
          initialAssignmentCount: 0, usedPurchaseSelection: false, convertedFreeGrant: false,
        },
      },
    });

    await persistLedgerAndMaterializeStoreAccess(account.id, expiredEvidence);
    await persistLedgerAndMaterializeStoreAccess(account.id, expiredEvidence);

    expect(await prisma.billingPeriod.count({ where: { billingAccountId: account.id } })).toBe(2);
    await expect(prisma.billingPurchaseSelection.findUniqueOrThrow({ where: { id: selection.id } }))
      .resolves.toMatchObject({ status: 'APPLIED', version: 3, consumedByPeriodId: materializedPeriod.id });
    await expect(prisma.billingCheckoutAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
      .resolves.toMatchObject({ status: 'VERIFIED', version: 2, terminalAt: expect.any(Date) });
    await expect(prisma.billingVerification.findUniqueOrThrow({ where: { checkoutAttemptId: attempt.id } }))
      .resolves.toMatchObject({
        status: 'VERIFIED', providerSubscriptionChainId: providerPeriod.subscription.chain.id,
        providerTransactionId: providerPeriod.transaction!.providerTransactionId,
        verifiedAt: expect.any(Date),
      });
    expect(await prisma.billingAuditLog.count({
      where: { action: 'BILLING_CHECKOUT_ATTEMPT_COMPLETED', targetId: attempt.id },
    })).toBe(1);
    await expect(resolvePaidAccessShadow(account.id)).resolves.toMatchObject({ state: 'NONE' });
    await expect(getBillingState(USER_ID)).resolves.toMatchObject({
      effectiveAccess: 'FREE', effectiveCapacity: 1, purchasesEnabled: false,
    });
  }, 30_000);

  test('fails closed when an invalid post-purchase free grant conflicts with immutable slot one', async () => {
    const { account, normalized } = await setup();
    await createDivisions();
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);
    await prisma.freeManagementGrant.create({
      data: {
        userId: USER_ID,
        billingAccountId: account.id,
        divisionId: `${DOMAIN_PREFIX}-division-a`,
        divisionIdSnapshot: `${DOMAIN_PREFIX}-division-a`,
        divisionNameSnapshot: 'Division historica',
        leagueId: `${DOMAIN_PREFIX}-league`,
        leagueIdSnapshot: `${DOMAIN_PREFIX}-league`,
        leagueNameSnapshot: 'Liga historica',
        source: 'INITIAL_FREE',
      },
    });

    await expect(persistLedgerAndMaterializeStoreAccess(account.id, normalized))
      .rejects.toMatchObject({ code: 'BILLING_FREE_GRANT_CONFLICT', statusCode: 409 });
    const actor = { id: USER_ID, email: `${USER_ID}@example.test`, rol: 'LIGA' as const };
    const previousEnforcement = env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED;
    env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED = true;
    try {
      await expect(divisionService.update(
        `${DOMAIN_PREFIX}-division-a`, { nombre: 'No debe persistir' }, actor,
      )).rejects.toMatchObject({ code: 'BILLING_EVIDENCE_INVALID' });
      await expect(divisionService.delete(`${DOMAIN_PREFIX}-division-a`, actor))
        .rejects.toMatchObject({ code: 'BILLING_EVIDENCE_INVALID' });
      await expect(prisma.division.findUniqueOrThrow({ where: { id: `${DOMAIN_PREFIX}-division-a` } }))
        .resolves.toMatchObject({ nombre: 'Division a' });
    } finally {
      env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED = previousEnforcement;
    }
  }, 30_000);

  test('applies an in-cycle upgrade once without replacing the effective period', async () => {
    const { account, normalized } = await setup();
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);
    const upgrade = revisedCommercialEvidence(normalized, {
      capacity: 3,
      transactionId: 'GPA.it-effective-access-upgrade-cycle',
      periodStart: ACTIVE_PERIOD_START.toISOString(),
      periodEnd: ACTIVE_PERIOD_END.toISOString(),
      providerPeriodKey: 'GPA.it-effective-access-1',
    });

    await persistLedgerAndMaterializeStoreAccess(account.id, upgrade);
    await persistLedgerAndMaterializeStoreAccess(account.id, upgrade);

    expect(await prisma.billingPeriod.count({ where: { billingAccountId: account.id } })).toBe(1);
    await expect(prisma.billingCapacityGrant.findMany({
      where: { billingPeriod: { billingAccountId: account.id } },
      select: { previousCapacity: true, newCapacity: true, sequence: true },
    })).resolves.toEqual([{ previousCapacity: 2, newCapacity: 3, sequence: 1 }]);
    await expect(resolvePaidAccessShadow(account.id)).resolves.toMatchObject({ state: 'PAID', capacity: 3 });
  }, 30_000);

  test('renews without compacting sparse slots when capacity is preserved', async () => {
    const { account, normalized } = await setup();
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);
    await createDivisions();
    const firstPeriod = await prisma.billingPeriod.findFirstOrThrow({ where: { billingAccountId: account.id } });
    await assignDivisionCapacity({
      billingPeriodId: firstPeriod.id,
      divisionId: `${DOMAIN_PREFIX}-division-a`,
      assignmentSource: 'DIRECT',
      slotNumber: 2,
    });
    const renewal = revisedCommercialEvidence(normalized, {
      capacity: 2,
      transactionId: 'GPA.it-effective-access-renewal',
      periodStart: RENEWAL_PERIOD_START.toISOString(),
      periodEnd: RENEWAL_PERIOD_END.toISOString(),
    });

    await persistLedgerAndMaterializeStoreAccess(account.id, renewal);

    const periods = await prisma.billingPeriod.findMany({
      where: { billingAccountId: account.id },
      orderBy: { effectiveStart: 'asc' },
      include: { assignments: true },
    });
    expect(periods).toHaveLength(2);
    expect(periods[0]).toMatchObject({ endReason: 'SUPERSEDED', replacedByPeriodId: periods[1].id });
    expect(periods[1]).toMatchObject({ renewalOfPeriodId: periods[0].id });
    expect(periods[1].assignments).toHaveLength(1);
    expect(periods[1].assignments[0]).toMatchObject({
      slotNumber: 2,
      divisionIdSnapshot: `${DOMAIN_PREFIX}-division-a`,
      assignmentSource: 'PERIOD_ROLLOVER',
    });
  }, 30_000);

  test('keeps the oldest assignments and compacts them deterministically on downgrade', async () => {
    const { account, normalized } = await setup();
    const capacityThree = revisedCommercialEvidence(normalized, {
      capacity: 3,
      transactionId: 'GPA.it-effective-access-capacity-three',
      periodStart: ACTIVE_PERIOD_START.toISOString(),
      periodEnd: ACTIVE_PERIOD_END.toISOString(),
      providerPeriodKey: 'GPA.it-effective-access-1',
    });
    await persistLedgerAndMaterializeStoreAccess(account.id, capacityThree);
    await createDivisions();
    const firstPeriod = await prisma.billingPeriod.findFirstOrThrow({ where: { billingAccountId: account.id } });
    await assignDivisionCapacity({
      billingPeriodId: firstPeriod.id,
      divisionId: `${DOMAIN_PREFIX}-division-a`,
      assignmentSource: 'DIRECT',
      slotNumber: 3,
    });
    await assignDivisionCapacity({
      billingPeriodId: firstPeriod.id,
      divisionId: `${DOMAIN_PREFIX}-division-b`,
      assignmentSource: 'DIRECT',
      slotNumber: 1,
    });
    await assignDivisionCapacity({
      billingPeriodId: firstPeriod.id,
      divisionId: `${DOMAIN_PREFIX}-division-c`,
      assignmentSource: 'DIRECT',
      slotNumber: 2,
    });
    const downgrade = revisedCommercialEvidence(capacityThree, {
      capacity: 2,
      transactionId: 'GPA.it-effective-access-downgrade',
      periodStart: RENEWAL_PERIOD_START.toISOString(),
      periodEnd: RENEWAL_PERIOD_END.toISOString(),
      providerStatusUpdatedAt: new Date().toISOString(),
    });

    await persistLedgerAndMaterializeStoreAccess(account.id, downgrade);

    const currentPeriod = await prisma.billingPeriod.findFirstOrThrow({
      where: { billingAccountId: account.id, endedEarlyAt: null },
      include: { assignments: { orderBy: { slotNumber: 'asc' } } },
    });
    expect(currentPeriod.capacityAtStart).toBe(2);
    expect(currentPeriod.assignments).toMatchObject([
      {
        slotNumber: 1,
        divisionIdSnapshot: `${DOMAIN_PREFIX}-division-a`,
        assignmentSource: 'RENEWAL_FALLBACK',
      },
      {
        slotNumber: 2,
        divisionIdSnapshot: `${DOMAIN_PREFIX}-division-b`,
        assignmentSource: 'RENEWAL_FALLBACK',
      },
    ]);
  }, 30_000);

  test('enforces non-overlapping periods, increasing grants, slot capacity, and immutability', async () => {
    const { account, normalized } = await setup();
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);
    const period = await prisma.billingPeriod.findFirstOrThrow({
      where: { billingAccountId: account.id },
      include: { primaryProviderPeriod: { include: { subscription: true } } },
    });

    await expect(prisma.$transaction(async (tx) => {
      await tx.billingPeriod.create({
        data: {
          id: 'it-overlapping-effective-period',
          billingAccountId: account.id,
          materializationKey: 'it-overlapping-effective-period',
          logicalProductIdSnapshot: period.logicalProductIdSnapshot,
          capacityAtStart: 2,
          billingIntervalAtStart: 'MONTHLY',
          effectiveStart: new Date(period.effectiveStart.getTime() + 1_000),
          effectiveEnd: period.effectiveEnd,
          primaryProviderPeriodId: period.primaryProviderPeriodId,
          providerSources: { create: { billingProviderPeriodId: period.primaryProviderPeriodId, isPrimary: true } },
        },
      });
    })).rejects.toThrow();

    const upgradeTransaction = await prisma.billingTransaction.create({
      data: {
        billingAccountId: account.id,
        providerSubscriptionId: period.primaryProviderPeriod.subscription.id,
        store: 'GOOGLE',
        storeEnvironment: 'SANDBOX',
        providerTransactionId: 'GPA.it-effective-access-upgrade',
        eventType: 'PRODUCT_CHANGE',
        logicalProductId: 'tenka_capacity_3',
        storeProductId: 'tenka_capacity_3',
        basePlanId: 'monthly',
        capacity: 3,
        billingInterval: 'MONTHLY',
        purchasedAt: new Date(),
      },
    });
    const [{ now }] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
    const grant = await prisma.billingCapacityGrant.create({
      data: {
        billingPeriodId: period.id,
        billingTransactionId: upgradeTransaction.id,
        previousCapacity: 2,
        newCapacity: 3,
        logicalProductIdSnapshot: 'tenka_capacity_3',
        effectiveAt: now,
        sequence: 1,
      },
    });
    const assignment = await prisma.divisionCapacityAssignment.create({
      data: {
        billingPeriodId: period.id,
        slotNumber: 3,
        divisionIdSnapshot: 'it-deleted-division',
        divisionNameSnapshot: 'Division historica',
        leagueIdSnapshot: 'it-deleted-league',
        leagueNameSnapshot: 'Liga historica',
        ownerUserIdSnapshot: USER_ID,
        assignedAt: now,
        assignmentSource: 'DIRECT',
      },
    });

    await expect(prisma.divisionCapacityAssignment.create({
      data: {
        billingPeriodId: period.id,
        slotNumber: 4,
        divisionIdSnapshot: 'it-over-capacity-division',
        divisionNameSnapshot: 'Fuera de capacidad',
        leagueIdSnapshot: 'it-deleted-league',
        leagueNameSnapshot: 'Liga historica',
        ownerUserIdSnapshot: USER_ID,
        assignmentSource: 'DIRECT',
      },
    })).rejects.toThrow();
    await expect(prisma.billingCapacityGrant.update({
      where: { id: grant.id }, data: { newCapacity: 4 },
    })).rejects.toThrow();
    await expect(prisma.billingCapacityGrant.delete({ where: { id: grant.id } })).rejects.toThrow();
    await expect(prisma.divisionCapacityAssignment.update({
      where: { id: assignment.id }, data: { slotNumber: 2 },
    })).rejects.toThrow();
    await expect(prisma.divisionCapacityAssignment.delete({ where: { id: assignment.id } })).rejects.toThrow();
    const source = await prisma.billingPeriodSource.findFirstOrThrow({ where: { billingPeriodId: period.id } });
    await expect(prisma.billingPeriodSource.delete({ where: { id: source.id } })).rejects.toThrow();
    await expect(resolvePaidAccessShadow(account.id)).resolves.toMatchObject({ state: 'PAID', capacity: 3 });
  }, 30_000);

  test('ends a current period when corrected provider evidence has already elapsed', async () => {
    const { account, normalized } = await setup();
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);

    const correction = structuredClone(normalized);
    const subscription = correction.subscriptions[0];
    subscription.providerStatus = 'EXPIRED';
    subscription.providerStatusUpdatedAt = new Date();
    subscription.entitlementActive = false;
    subscription.eligibleForNewAccess = false;
    subscription.providerAccessEndsAt = CORRECTED_PERIOD_END;
    subscription.canonicalEvidenceReference = 'corrected-subscription-evidence';
    subscription.periods[0].providerPeriodEnd = CORRECTED_PERIOD_END;
    subscription.periods[0].providerStatus = 'EXPIRED';
    subscription.periods[0].entitlementActive = false;
    subscription.periods[0].dedupeKey = 'corrected-period-dedupe';
    subscription.periods[0].canonicalEvidenceReference = 'corrected-period-evidence';

    await persistLedgerAndMaterializeStoreAccess(account.id, correction);

    await expect(prisma.billingPeriod.findFirstOrThrow({
      where: { billingAccountId: account.id },
      select: { endedEarlyAt: true, endReason: true, providerEndedAt: true },
    })).resolves.toMatchObject({
      endedEarlyAt: expect.any(Date),
      endReason: 'PROVIDER_CORRECTION',
      providerEndedAt: CORRECTED_PERIOD_END,
    });
  }, 30_000);

  test('serializes assignments and derives immutable division snapshots on the server', async () => {
    const { account, normalized } = await setup();
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);
    await createDivisions();
    const period = await prisma.billingPeriod.findFirstOrThrow({ where: { billingAccountId: account.id } });

    const first = await assignDivisionCapacity({
      billingPeriodId: period.id,
      divisionId: `${DOMAIN_PREFIX}-division-a`,
      assignmentSource: 'DIRECT',
      slotNumber: 1,
    });
    expect(first).toMatchObject({
      slotNumber: 1,
      divisionIdSnapshot: `${DOMAIN_PREFIX}-division-a`,
      divisionNameSnapshot: 'Division a',
      leagueNameSnapshot: 'Liga billing',
      ownerUserIdSnapshot: USER_ID,
    });

    const contenders = await Promise.allSettled([
      assignDivisionCapacity({
        billingPeriodId: period.id, divisionId: `${DOMAIN_PREFIX}-division-b`, assignmentSource: 'DIRECT', slotNumber: 2,
      }),
      assignDivisionCapacity({
        billingPeriodId: period.id, divisionId: `${DOMAIN_PREFIX}-division-c`, assignmentSource: 'DIRECT', slotNumber: 2,
      }),
    ]);
    expect(contenders.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(contenders.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(await prisma.divisionCapacityAssignment.count({ where: { billingPeriodId: period.id } })).toBe(2);

    await prisma.division.delete({ where: { id: `${DOMAIN_PREFIX}-division-a` } });
    await expect(prisma.divisionCapacityAssignment.findFirstOrThrow({
      where: { billingPeriodId: period.id, divisionIdSnapshot: `${DOMAIN_PREFIX}-division-a` },
      select: { divisionId: true, divisionNameSnapshot: true, slotNumber: true },
    })).resolves.toEqual({ divisionId: null, divisionNameSnapshot: 'Division a', slotNumber: 1 });
  }, 30_000);

  test('creates a paid division and consumes the last slot atomically under concurrency', async () => {
    const { account, normalized } = await setup();
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);
    await createDivisions();
    await prisma.division.deleteMany({
      where: { id: { in: [`${DOMAIN_PREFIX}-division-b`, `${DOMAIN_PREFIX}-division-c`] } },
    });
    const period = await prisma.billingPeriod.findFirstOrThrow({ where: { billingAccountId: account.id } });
    await assignDivisionCapacity({
      billingPeriodId: period.id,
      divisionId: `${DOMAIN_PREFIX}-division-a`,
      assignmentSource: 'DIRECT',
      slotNumber: 1,
    });

    const previousEnforcement = env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED;
    env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED = true;
    try {
      const base = {
        maxEquipos: 8,
        ligaId: `${DOMAIN_PREFIX}-league`,
        categoriaId: `${DOMAIN_PREFIX}-category`,
        tipoId: `${DOMAIN_PREFIX}-type`,
        estadoLigaId: `${DOMAIN_PREFIX}-status`,
        tipoCompetenciaId: `${DOMAIN_PREFIX}-competition`,
      };
      const actor = { id: USER_ID, email: `${USER_ID}@example.test`, rol: 'LIGA' as const };
      const contenders = await Promise.allSettled([
        divisionService.create({ ...base, nombre: 'Contendiente uno' }, actor),
        divisionService.create({ ...base, nombre: 'Contendiente dos' }, actor),
      ]);

      expect(contenders.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(contenders.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      expect(await prisma.division.count({ where: { ligaId: `${DOMAIN_PREFIX}-league` } })).toBe(2);
      expect(await prisma.divisionCapacityAssignment.count({ where: { billingPeriodId: period.id } })).toBe(2);
    } finally {
      env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED = previousEnforcement;
    }
  }, 30_000);

  test('enforces the free boundary on real mutations while preserving deletion', async () => {
    const { account } = await setup();
    await createDivisions();
    await prisma.freeManagementGrant.create({
      data: {
        userId: USER_ID, billingAccountId: account.id,
        divisionId: `${DOMAIN_PREFIX}-division-a`, divisionIdSnapshot: `${DOMAIN_PREFIX}-division-a`,
        divisionNameSnapshot: 'Division a', leagueId: `${DOMAIN_PREFIX}-league`,
        leagueIdSnapshot: `${DOMAIN_PREFIX}-league`, leagueNameSnapshot: 'Liga billing',
        source: 'INITIAL_FREE',
      },
    });
    const actor = { id: USER_ID, email: `${USER_ID}@example.test`, rol: 'LIGA' as const };
    const previousEnforcement = env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED;
    env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED = true;
    try {
      await expect(divisionService.update(
        `${DOMAIN_PREFIX}-division-a`, { nombre: 'Division gratuita editable' }, actor,
      )).resolves.toMatchObject({ nombre: 'Division gratuita editable' });
      await expect(divisionService.update(
        `${DOMAIN_PREFIX}-division-b`, { nombre: 'No debe persistir' }, actor,
      )).rejects.toMatchObject({ code: 'BILLING_RESOURCE_READ_ONLY' });
      await expect(prisma.division.findUniqueOrThrow({ where: { id: `${DOMAIN_PREFIX}-division-b` } }))
        .resolves.toMatchObject({ nombre: 'Division b' });
      await expect(divisionService.delete(`${DOMAIN_PREFIX}-division-b`, actor)).resolves.toBeUndefined();
      await expect(prisma.division.findUnique({ where: { id: `${DOMAIN_PREFIX}-division-b` } })).resolves.toBeNull();
    } finally {
      env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED = previousEnforcement;
    }
  }, 30_000);

  test('enforces paid and local-grace assignments on real division mutations', async () => {
    const { account, normalized } = await setup();
    await createDivisions();
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);
    const period = await prisma.billingPeriod.findFirstOrThrow({
      where: { billingAccountId: account.id }, include: { assignments: true },
    });
    expect(period.assignments).toHaveLength(2);
    const assignedIds = period.assignments.map(({ divisionId }) => divisionId!);
    const unassignedId = DIVISION_IDS_FOR_TEST.find((id) => !assignedIds.includes(id))!;
    const actor = { id: USER_ID, email: `${USER_ID}@example.test`, rol: 'LIGA' as const };
    const previousEnforcement = env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED;
    env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED = true;
    try {
      await expect(divisionService.update(assignedIds[0], { nombre: 'Paid assigned' }, actor))
        .resolves.toMatchObject({ nombre: 'Paid assigned' });
      await expect(divisionService.update(unassignedId, { nombre: 'Paid unassigned' }, actor))
        .rejects.toMatchObject({ code: 'BILLING_RESOURCE_READ_ONLY' });

      const failed = failedBillingEvidence(normalized, period.assignments[0].assignedAt);
      await persistLedgerAndMaterializeStoreAccess(account.id, failed);
      await expect(resolvePaidAccessShadow(account.id)).resolves.toMatchObject({ state: 'LOCAL_GRACE' });
      await expect(divisionService.update(assignedIds[1], { nombre: 'Grace assigned' }, actor))
        .resolves.toMatchObject({ nombre: 'Grace assigned' });
      await expect(divisionService.update(unassignedId, { nombre: 'Grace unassigned' }, actor))
        .rejects.toMatchObject({ code: 'BILLING_RESOURCE_READ_ONLY' });
      await expect(prisma.division.findUniqueOrThrow({ where: { id: unassignedId } }))
        .resolves.toMatchObject({ nombre: expect.not.stringMatching(/unassigned/i) });
    } finally {
      env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED = previousEnforcement;
    }
  }, 45_000);

  test('projects private management DTOs without exposing them to a foreign reader', async () => {
    const { account, normalized } = await setup();
    await createDivisions();
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);
    const period = await prisma.billingPeriod.findFirstOrThrow({
      where: { billingAccountId: account.id }, include: { assignments: true },
    });
    const assignedId = period.assignments[0].divisionId!;
    const unassignedId = DIVISION_IDS_FOR_TEST.find((id) => !period.assignments.some(({ divisionId }) => divisionId === id))!;
    await prisma.user.create({ data: { id: FOREIGN_USER_ID, email: `${FOREIGN_USER_ID}@example.test`, rol: 'CAPITAN' } });
    const owner = { id: USER_ID, email: `${USER_ID}@example.test`, rol: 'LIGA' as const };
    const foreign = { id: FOREIGN_USER_ID, email: `${FOREIGN_USER_ID}@example.test`, rol: 'CAPITAN' as const };
    const previousEnforcement = env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED;
    env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED = true;
    try {
      await expect(divisionService.getById(assignedId, owner))
        .resolves.toMatchObject({ managementAccess: 'FULL', managementReason: 'PAID_ASSIGNED' });
      await expect(divisionService.getById(unassignedId, owner))
        .resolves.toMatchObject({ managementAccess: 'READ_ONLY', managementReason: 'UNASSIGNED' });
      const listed = await divisionService.listByLiga(`${DOMAIN_PREFIX}-league`, owner);
      expect(listed.find(({ id }) => id === assignedId)).toMatchObject({ managementAccess: 'FULL' });
      expect(listed.find(({ id }) => id === unassignedId)).toMatchObject({ managementAccess: 'READ_ONLY' });
      await expect(ligaService.getById(`${DOMAIN_PREFIX}-league`, owner))
        .resolves.toMatchObject({ managementAccess: 'FULL', managementReason: 'PAID_ASSIGNED' });

      const foreignDivision = await divisionService.getById(assignedId, foreign);
      const foreignList = await divisionService.listByLiga(`${DOMAIN_PREFIX}-league`, foreign);
      const foreignLeague = await ligaService.getById(`${DOMAIN_PREFIX}-league`, foreign);
      for (const value of [foreignDivision, ...foreignList, foreignLeague]) {
        expect(value).not.toHaveProperty('managementAccess');
        expect(value).not.toHaveProperty('managementReason');
        expect(value).not.toHaveProperty('migrationOverlayActive');
      }
    } finally {
      env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED = previousEnforcement;
    }
  }, 45_000);

  test('rolls back a shared-resource mutation when any paid division is unassigned', async () => {
    const { account, normalized } = await setup();
    await createDivisions();
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);
    const referee = await prisma.ligaArbitro.create({
      data: { ligaId: `${DOMAIN_PREFIX}-league`, nombre: 'Arbitro original' },
    });
    const actor = { id: USER_ID, email: `${USER_ID}@example.test`, rol: 'LIGA' as const };
    const previousEnforcement = env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED;
    env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED = true;
    try {
      await expect(ligaService.updateArbitro(
        `${DOMAIN_PREFIX}-league`, referee.id, { nombre: 'No debe persistir' }, actor,
      )).rejects.toMatchObject({ code: 'BILLING_SHARED_RESOURCE_LOCKED' });
      await expect(prisma.ligaArbitro.findUniqueOrThrow({ where: { id: referee.id } }))
        .resolves.toMatchObject({ nombre: 'Arbitro original' });
    } finally {
      env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED = previousEnforcement;
    }
  }, 30_000);

  test('rolls an assignment into a renewal after observing account-lock serialization', async () => {
    const { account, normalized } = await setup();
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);
    await createDivisions();
    const firstPeriod = await prisma.billingPeriod.findFirstOrThrow({ where: { billingAccountId: account.id } });
    const renewal = revisedCommercialEvidence(normalized, {
      capacity: 2,
      transactionId: 'GPA.it-effective-access-renewal-assignment-race',
      periodStart: RENEWAL_PERIOD_START.toISOString(),
      periodEnd: RENEWAL_PERIOD_END.toISOString(),
    });
    const inserted = deferred();
    const release = deferred();
    const assignment = prisma.$transaction(async (tx) => {
      const result = await assignDivisionCapacityInTransaction(tx, {
        billingPeriodId: firstPeriod.id, divisionId: `${DOMAIN_PREFIX}-division-c`,
        assignmentSource: 'DIRECT', slotNumber: 2,
      });
      inserted.resolve();
      await release.promise;
      return result;
    }, { isolationLevel: 'Serializable', timeout: 30_000 });
    await inserted.promise;
    const materialization = persistLedgerAndMaterializeStoreAccess(account.id, renewal);
    expect(await waitForBlockedAdvisoryLock()).toBe(true);
    release.resolve();
    await assignment;
    await materialization;

    const replacement = await prisma.billingPeriod.findFirstOrThrow({
      where: { billingAccountId: account.id, id: { not: firstPeriod.id } }, include: { assignments: true },
    });
    expect(replacement.renewalOfPeriodId).toBe(firstPeriod.id);
    expect(replacement.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        divisionId: `${DOMAIN_PREFIX}-division-c`, slotNumber: 2, assignmentSource: 'PERIOD_ROLLOVER',
      }),
    ]));
  }, 60_000);

  test('does not expose capacity from a future grant', async () => {
    const { account, normalized } = await setup();
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);
    await createDivisions();
    const period = await prisma.billingPeriod.findFirstOrThrow({ where: { billingAccountId: account.id } });
    const transaction = await prisma.billingTransaction.create({
      data: {
        billingAccountId: account.id,
        store: 'GOOGLE',
        storeEnvironment: 'SANDBOX',
        providerTransactionId: 'GPA.it-effective-access-future-grant',
        eventType: 'PRODUCT_CHANGE',
        logicalProductId: 'tenka_capacity_3',
        storeProductId: 'tenka_capacity_3',
        basePlanId: 'monthly',
        capacity: 3,
        billingInterval: 'MONTHLY',
        purchasedAt: new Date(),
      },
    });
    const future = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.billingCapacityGrant.create({
      data: {
        billingPeriodId: period.id,
        billingTransactionId: transaction.id,
        previousCapacity: 2,
        newCapacity: 3,
        logicalProductIdSnapshot: 'tenka_capacity_3',
        effectiveAt: future,
        sequence: 1,
      },
    });

    await expect(assignDivisionCapacity({
      billingPeriodId: period.id,
      divisionId: `${DOMAIN_PREFIX}-division-a`,
      assignmentSource: 'DIRECT',
      slotNumber: 3,
    })).rejects.toMatchObject({ statusCode: 409 });
  }, 30_000);

  test('rolls back a caller-owned domain write when transactional assignment fails', async () => {
    const { account, normalized } = await setup();
    await persistLedgerAndMaterializeStoreAccess(account.id, normalized);
    await createDivisions();
    const period = await prisma.billingPeriod.findFirstOrThrow({ where: { billingAccountId: account.id } });
    const divisionId = `${DOMAIN_PREFIX}-division-atomic`;

    await expect(prisma.$transaction(async (tx) => {
      await tx.division.create({
        data: {
          id: divisionId,
          nombre: 'Division atomic',
          maxEquipos: 8,
          ligaId: `${DOMAIN_PREFIX}-league`,
          categoriaId: `${DOMAIN_PREFIX}-category`,
          tipoId: `${DOMAIN_PREFIX}-type`,
          estadoLigaId: `${DOMAIN_PREFIX}-status`,
          tipoCompetenciaId: `${DOMAIN_PREFIX}-competition`,
        },
      });
      await assignDivisionCapacityInTransaction(tx, {
        billingPeriodId: period.id,
        divisionId,
        assignmentSource: 'DIRECT',
        slotNumber: 3,
      });
    })).rejects.toMatchObject({ statusCode: 409 });

    await expect(prisma.division.findUnique({ where: { id: divisionId } })).resolves.toBeNull();
  }, 30_000);
});
