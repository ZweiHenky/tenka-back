import { afterEach, describe, expect, test } from 'vitest';
import { prisma } from '../../config/database';
import { truncateIntegrationBillingData } from '../../test/integration/cleanup';
import { ensureBillingAccount } from './service';
import {
  applyExpiredBillingMigrationInTransaction,
  markMigrationPurchasedInTransaction,
  selectMigrationFreeDivision,
} from './migrationLifecycleService';
import { processBillingMigrationExpirations } from './billingMigrationExpiryWorker';
import { resolveDivisionAccessShadowInTransaction } from './resourceAccessShadow';
import { setAdminBillingOperationalControl } from './operationalControlService';
import { ligaService } from '../liga/service';
import { divisionService } from '../division/service';

const PREFIX = 'it-billing-migration-lifecycle';
const USER_ID = `${PREFIX}-user`;
const DIVISION_IDS = [`${PREFIX}-division-a`, `${PREFIX}-division-b`];

async function cleanup() {
  const openPause = await prisma.billingOperationalPause.findFirst({
    where: { environment: 'PREVIEW', endedAt: null }, select: { id: true, startedAt: true },
  });
  if (openPause) {
    await prisma.billingOperationalPause.update({
      where: { id: openPause.id },
      data: { endedAt: new Date(openPause.startedAt.getTime() + 1), endedByAdminId: `${PREFIX}-cleanup` },
    });
  }
  await prisma.billingOperationalControl.update({
    where: { environment: 'PREVIEW' },
    data: { mode: 'PURCHASES_PAUSED', reason: 'Integration cleanup', version: { increment: 1 } },
  });
  await prisma.$transaction((tx) => truncateIntegrationBillingData(tx));
  await prisma.division.deleteMany({ where: { id: { in: DIVISION_IDS } } });
  await prisma.liga.deleteMany({ where: { id: `${PREFIX}-league` } });
  await prisma.ubicacion.deleteMany({ where: { id: `${PREFIX}-location` } });
  await prisma.categoria.deleteMany({ where: { id: `${PREFIX}-category` } });
  await prisma.tipo.deleteMany({ where: { id: `${PREFIX}-type` } });
  await prisma.estadoLiga.deleteMany({ where: { id: `${PREFIX}-status` } });
  await prisma.tipoCompetencia.deleteMany({ where: { id: `${PREFIX}-competition` } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
}

afterEach(cleanup);

async function setupPreparedMigration() {
  const existingPause = await prisma.billingOperationalPause.findFirst({
    where: { environment: 'PREVIEW', endedAt: null }, select: { id: true, startedAt: true },
  });
  if (existingPause) {
    await prisma.billingOperationalPause.update({
      where: { id: existingPause.id },
      data: { endedAt: new Date(existingPause.startedAt.getTime() + 1), endedByAdminId: `${PREFIX}-setup` },
    });
  }
  await prisma.user.create({ data: { id: USER_ID, email: `${USER_ID}@example.test`, rol: 'LIGA' } });
  const account = await prisma.$transaction((tx) => ensureBillingAccount(tx, USER_ID));
  await prisma.ubicacion.create({
    data: { id: `${PREFIX}-location`, lat: 0, lng: 0, nombreCompleto: 'Test', estado: 'Test', municipio: 'Test', timeZone: 'UTC' },
  });
  await prisma.liga.create({
    data: {
      id: `${PREFIX}-league`, nombre: 'Liga migration lifecycle', nombreNormalizado: PREFIX,
      descripcion: 'Test', userId: USER_ID, ubicacionId: `${PREFIX}-location`,
    },
  });
  await Promise.all([
    prisma.categoria.create({ data: { id: `${PREFIX}-category`, nombre: 'Migration lifecycle' } }),
    prisma.tipo.create({ data: { id: `${PREFIX}-type`, nombre: 'Migration lifecycle' } }),
    prisma.estadoLiga.create({ data: { id: `${PREFIX}-status`, nombre: 'Migration lifecycle', codigo: 'EN_CURSO' } }),
    prisma.tipoCompetencia.create({ data: { id: `${PREFIX}-competition`, nombre: 'Migration lifecycle', codigo: 'LIGA_Y_ELIMINATORIAS' } }),
  ]);
  for (const [index, id] of DIVISION_IDS.entries()) {
    await prisma.division.create({
      data: {
        id, nombre: `Division migration ${index + 1}`, maxEquipos: 8,
        ligaId: `${PREFIX}-league`, categoriaId: `${PREFIX}-category`, tipoId: `${PREFIX}-type`,
        estadoLigaId: `${PREFIX}-status`, tipoCompetenciaId: `${PREFIX}-competition`,
      },
    });
  }
  const divisions = await prisma.division.findMany({
    where: { id: { in: DIVISION_IDS } }, orderBy: { createdAt: 'asc' },
    select: { id: true, createdAt: true, ligaId: true },
  });
  const migration = await prisma.billingMigrationAccess.create({
    data: {
      id: `${PREFIX}-access`, billingAccountId: account.id, status: 'PREPARED',
      preparedAt: new Date(), preparedDivisionCount: divisions.length,
      divisions: {
        create: divisions.map((division, index) => ({
          id: `${PREFIX}-snapshot-${index}`, divisionId: division.id,
          divisionIdSnapshot: division.id, divisionCreatedAtSnapshot: division.createdAt,
          leagueIdSnapshot: division.ligaId,
        })),
      },
    },
  });
  await prisma.billingOperationalControl.update({
    where: { environment: 'PREVIEW' },
    data: { mode: 'ENABLED', reason: 'Integration activation', version: { increment: 1 } },
  });
  return { account, migration };
}

async function activateMigrationFixture(input: {
  billingAccountId: string;
  actor: { userId: string; requestId: string };
  reason: string;
}) {
  return prisma.$transaction(async (tx) => {
    const migration = await tx.billingMigrationAccess.findUniqueOrThrow({ where: { billingAccountId: input.billingAccountId } });
    if (migration.status !== 'PREPARED') return migration;
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
    const activated = await tx.billingMigrationAccess.update({
      where: { id: migration.id },
      data: {
        status: 'SELECTION_REQUIRED', startedAt: now, activatedAt: now,
        deadline: new Date(now.getTime() + 30 * 86_400_000),
      },
    });
    await tx.billingAuditLog.create({
      data: {
        action: 'BILLING_MIGRATION_ACTIVATED', actorType: 'USER',
        actorUserId: input.actor.userId, actorUserIdSnapshot: input.actor.userId,
        targetType: 'BillingMigrationAccess', targetId: migration.id,
        requestId: input.actor.requestId, reason: input.reason,
        metadataRedacted: { migrationDays: 30, capturedDivisions: migration.preparedDivisionCount },
      },
    });
    return activated;
  });
}

async function createActivePaidPeriod(billingAccountId: string) {
  const chain = await prisma.billingProviderSubscriptionChain.create({
    data: {
      id: `${PREFIX}-chain`, billingAccountId, store: 'GOOGLE',
      providerChainReference: `${PREFIX}-chain-reference`,
    },
  });
  const subscription = await prisma.billingProviderSubscription.create({
    data: {
      id: `${PREFIX}-subscription`, providerSubscriptionChainId: chain.id,
      store: 'GOOGLE', storeEnvironment: 'SANDBOX', providerSubscriptionKey: `${PREFIX}-subscription-key`,
      providerStatus: 'ACTIVE', providerStatusUpdatedAt: new Date('2026-01-01T00:00:00Z'),
      entitlementActive: true, providerAccessEndsAt: new Date('2099-01-01T00:00:00Z'), willRenew: true,
      currentLogicalProductId: 'tenka_capacity_2', currentStoreProductId: 'tenka_capacity_2',
      currentBasePlanId: 'monthly', currentCapacity: 2, currentBillingInterval: 'MONTHLY',
      ownershipType: 'PURCHASED',
    },
  });
  const transaction = await prisma.billingTransaction.create({
    data: {
      id: `${PREFIX}-transaction`, billingAccountId, providerSubscriptionId: subscription.id,
      store: 'GOOGLE', storeEnvironment: 'SANDBOX', providerTransactionId: `${PREFIX}-provider-transaction`,
      eventType: 'INITIAL_PURCHASE', logicalProductId: 'tenka_capacity_2', storeProductId: 'tenka_capacity_2',
      basePlanId: 'monthly', capacity: 2, billingInterval: 'MONTHLY', purchasedAt: new Date('2026-01-01T00:00:00Z'),
    },
  });
  const providerPeriod = await prisma.billingProviderPeriod.create({
    data: {
      id: `${PREFIX}-provider-period`, billingAccountId, providerSubscriptionId: subscription.id,
      billingTransactionId: transaction.id, store: 'GOOGLE', storeEnvironment: 'SANDBOX',
      providerPeriodKey: `${PREFIX}-provider-period-key`, dedupeKey: `${PREFIX}-provider-period-dedupe`,
      logicalProductId: 'tenka_capacity_2', storeProductId: 'tenka_capacity_2', basePlanId: 'monthly',
      capacity: 2, billingInterval: 'MONTHLY', providerPeriodStart: new Date('2026-01-01T00:00:00Z'),
      providerPeriodEnd: new Date('2099-01-01T00:00:00Z'), providerStatus: 'ACTIVE', entitlementActive: true,
    },
  });
  return prisma.billingPeriod.create({
    data: {
      id: `${PREFIX}-period`, billingAccountId, materializationKey: `${PREFIX}-materialization`,
      logicalProductIdSnapshot: 'tenka_capacity_2', capacityAtStart: 2, billingIntervalAtStart: 'MONTHLY',
      effectiveStart: new Date('2026-01-01T00:00:00Z'), effectiveEnd: new Date('2099-01-01T00:00:00Z'),
      providerStartedAt: new Date('2026-01-01T00:00:00Z'), primaryProviderPeriodId: providerPeriod.id,
      enforcedAt: new Date('2026-01-01T00:00:00Z'),
      providerSources: { create: { billingProviderPeriodId: providerPeriod.id, isPrimary: true } },
      assignments: {
        create: {
          slotNumber: 1, divisionId: DIVISION_IDS[0], divisionIdSnapshot: DIVISION_IDS[0],
          divisionNameSnapshot: 'Division migration 1', leagueIdSnapshot: `${PREFIX}-league`,
          leagueNameSnapshot: 'Liga migration lifecycle', ownerUserIdSnapshot: USER_ID,
          assignedAt: new Date('2026-01-01T00:00:00Z'), assignmentSource: 'DIRECT',
        },
      },
    },
  });
}

describe('billing migration lifecycle', () => {
  test('activates atomically, exposes MIGRATION and preserves an explicit selection', async () => {
    const { account } = await setupPreparedMigration();
    const activated = await activateMigrationFixture({
      billingAccountId: account.id, reason: 'Approve integration migration activation',
      actor: { userId: `${PREFIX}-admin`, requestId: `${PREFIX}-activate` },
    });
    expect(activated.status).toBe('SELECTION_REQUIRED');
    expect(activated.startedAt).toEqual(activated.activatedAt);
    expect(activated.deadline!.getTime() - activated.startedAt!.getTime()).toBe(30 * 86_400_000);
    await expect(activateMigrationFixture({
      billingAccountId: account.id, reason: 'Retry approved integration migration activation',
      actor: { userId: `${PREFIX}-admin`, requestId: `${PREFIX}-activate-retry` },
    })).resolves.toEqual(activated);
    await expect(prisma.billingAuditLog.count({
      where: { action: 'BILLING_MIGRATION_ACTIVATED', requestId: `${PREFIX}-activate` },
    })).resolves.toBe(1);

    const decision = await prisma.$transaction((tx) => resolveDivisionAccessShadowInTransaction(
      tx,
      { divisionId: DIVISION_IDS[1], actor: { id: USER_ID, rol: 'LIGA' } },
    ));
    expect(decision).toMatchObject({
      access: 'FULL', reason: 'MIGRATION', basis: 'MIGRATION',
      migrationOverlayActive: true,
    });

    await selectMigrationFreeDivision({
      userId: USER_ID, divisionIdSnapshot: DIVISION_IDS[1], requestId: `${PREFIX}-select`,
    });
    const selectionRetry = await selectMigrationFreeDivision({
      userId: USER_ID, divisionIdSnapshot: DIVISION_IDS[1], requestId: `${PREFIX}-select-retry`,
    });
    expect(selectionRetry).toMatchObject({ status: 'SELECTED', selectedFreeDivisionIdSnapshot: DIVISION_IDS[1] });
    expect(selectionRetry).not.toHaveProperty('divisions');
    await expect(selectMigrationFreeDivision({
      userId: USER_ID, divisionIdSnapshot: DIVISION_IDS[0], requestId: `${PREFIX}-select-conflict`,
    })).rejects.toMatchObject({ statusCode: 409 });
  }, 30_000);

  test('replays an activated migration while operational billing is paused', async () => {
    const { account } = await setupPreparedMigration();
    const activated = await activateMigrationFixture({
      billingAccountId: account.id, reason: 'Approve replay integration migration',
      actor: { userId: `${PREFIX}-admin`, requestId: `${PREFIX}-activate-before-pause` },
    });
    const control = await prisma.billingOperationalControl.findUniqueOrThrow({ where: { environment: 'PREVIEW' } });
    await setAdminBillingOperationalControl({
      control: { mode: 'PURCHASES_PAUSED', reason: 'Pause before activation replay', expectedVersion: control.version },
      idempotencyKey: `${PREFIX}-pause-before-replay`,
      actor: { userId: `${PREFIX}-admin`, requestId: `${PREFIX}-pause-before-replay-request` },
    });
    await expect(activateMigrationFixture({
      billingAccountId: account.id, reason: 'Replay approved integration migration',
      actor: { userId: `${PREFIX}-admin`, requestId: `${PREFIX}-activate-during-pause` },
    })).resolves.toEqual(activated);
    await expect(prisma.billingAuditLog.count({
      where: { action: 'BILLING_MIGRATION_ACTIVATED', requestId: `${PREFIX}-activate-before-pause` },
    })).resolves.toBe(1);
  }, 30_000);

  test('keeps the overlay active during a pause and extends the deadline once on resume', async () => {
    const { account } = await setupPreparedMigration();
    const activated = await activateMigrationFixture({
      billingAccountId: account.id, reason: 'Approve integration migration activation',
      actor: { userId: `${PREFIX}-admin`, requestId: `${PREFIX}-activate-pause` },
    });
    const control = await prisma.billingOperationalControl.findUniqueOrThrow({ where: { environment: 'PREVIEW' } });
    await setAdminBillingOperationalControl({
      control: { mode: 'PURCHASES_PAUSED', reason: 'Pause migration integration test', expectedVersion: control.version },
      idempotencyKey: `${PREFIX}-pause`, actor: { userId: `${PREFIX}-admin`, requestId: `${PREFIX}-pause-request` },
    });
    const paused = await prisma.$transaction((tx) => resolveDivisionAccessShadowInTransaction(
      tx,
      { divisionId: DIVISION_IDS[0], actor: { id: USER_ID, rol: 'LIGA' } },
    ));
    expect(paused).toMatchObject({ access: 'FULL', reason: 'MIGRATION', migrationPaused: true });

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const pausedControl = await prisma.billingOperationalControl.findUniqueOrThrow({ where: { environment: 'PREVIEW' } });
    await setAdminBillingOperationalControl({
      control: { mode: 'ENABLED', reason: 'Resume migration integration test', expectedVersion: pausedControl.version },
      idempotencyKey: `${PREFIX}-resume`, actor: { userId: `${PREFIX}-admin`, requestId: `${PREFIX}-resume-request` },
    });
    const resumed = await prisma.billingMigrationAccess.findUniqueOrThrow({ where: { id: activated.id } });
    const application = await prisma.billingMigrationPauseApplication.findUniqueOrThrow({
      where: {
        billingMigrationAccessId_billingOperationalPauseId: {
          billingMigrationAccessId: activated.id,
          billingOperationalPauseId: (await prisma.billingOperationalPause.findFirstOrThrow({
            where: { environment: 'PREVIEW' }, orderBy: { startedAt: 'desc' }, select: { id: true },
          })).id,
        },
      },
    });
    expect(application.extensionMilliseconds).not.toBeNull();
    expect(resumed.deadline!.getTime() - activated.deadline!.getTime())
      .toBe(Number(application.extensionMilliseconds));
  }, 30_000);

  test('does not revive or extend an already expired migration when a later pause opens', async () => {
    const { account, migration } = await setupPreparedMigration();
    const now = new Date();
    await prisma.billingMigrationAccess.update({
      where: { id: migration.id },
      data: {
        status: 'SELECTION_REQUIRED', startedAt: new Date(now.getTime() - 31 * 86_400_000),
        activatedAt: new Date(now.getTime() - 31 * 86_400_000), deadline: new Date(now.getTime() - 60_000),
      },
    });
    const control = await prisma.billingOperationalControl.findUniqueOrThrow({ where: { environment: 'PREVIEW' } });
    await setAdminBillingOperationalControl({
      control: { mode: 'PURCHASES_PAUSED', reason: 'Pause after migration deadline', expectedVersion: control.version },
      idempotencyKey: `${PREFIX}-late-pause`, actor: { userId: `${PREFIX}-admin`, requestId: `${PREFIX}-late-pause-request` },
    });
    const decision = await prisma.$transaction((tx) => resolveDivisionAccessShadowInTransaction(
      tx, { divisionId: DIVISION_IDS[0], actor: { id: USER_ID, rol: 'LIGA' } },
    ));
    expect(decision).toMatchObject({ migrationOverlayActive: false, migrationPaused: false });

    const pausedControl = await prisma.billingOperationalControl.findUniqueOrThrow({ where: { environment: 'PREVIEW' } });
    await setAdminBillingOperationalControl({
      control: { mode: 'ENABLED', reason: 'Resume after migration deadline', expectedVersion: pausedControl.version },
      idempotencyKey: `${PREFIX}-late-resume`, actor: { userId: `${PREFIX}-admin`, requestId: `${PREFIX}-late-resume-request` },
    });
    await expect(prisma.billingMigrationPauseApplication.count({
      where: { billingMigrationAccessId: migration.id },
    })).resolves.toBe(0);
    await expect(prisma.billingMigrationAccess.findUniqueOrThrow({ where: { billingAccountId: account.id } }))
      .resolves.toMatchObject({ deadline: new Date(now.getTime() - 60_000) });
  }, 30_000);

  test('blocks league and division creation for every active migration state', async () => {
    const { account, migration } = await setupPreparedMigration();
    await activateMigrationFixture({
      billingAccountId: account.id, reason: 'Approve creation blocking integration migration',
      actor: { userId: `${PREFIX}-admin`, requestId: `${PREFIX}-activate-creation-block` },
    });
    const actor = { id: USER_ID, email: `${USER_ID}@example.test`, rol: 'LIGA' as const };
    for (const status of ['SELECTION_REQUIRED', 'SELECTED', 'PURCHASED'] as const) {
      if (status === 'SELECTED') {
        await prisma.billingMigrationAccess.update({
          where: { id: migration.id },
          data: { status, selectedFreeDivisionIdSnapshot: DIVISION_IDS[0] },
        });
      } else if (status === 'PURCHASED') {
        await prisma.billingMigrationAccess.update({ where: { id: migration.id }, data: { status } });
      }
      await expect(ligaService.create({
        nombre: `Blocked ${status}`, descripcion: 'Must not be created', ubicacionId: `${PREFIX}-location`,
      }, actor)).rejects.toMatchObject({ code: 'BILLING_MIGRATION_CREATION_BLOCKED' });
      await expect(divisionService.create({
        nombre: `Blocked ${status}`, maxEquipos: 8, ligaId: `${PREFIX}-league`,
        categoriaId: `${PREFIX}-category`, tipoId: `${PREFIX}-type`, tipoCompetenciaId: `${PREFIX}-competition`,
      }, actor)).rejects.toMatchObject({ code: 'BILLING_MIGRATION_CREATION_BLOCKED' });
    }
    await expect(prisma.liga.count({ where: { userId: USER_ID } })).resolves.toBe(1);
    await expect(prisma.division.count({ where: { liga: { userId: USER_ID } } })).resolves.toBe(2);
  }, 30_000);

  test('marks a migration purchased, preserves PAID precedence and expires without a free grant', async () => {
    const { account } = await setupPreparedMigration();
    await activateMigrationFixture({
      billingAccountId: account.id, reason: 'Approve paid migration integration',
      actor: { userId: `${PREFIX}-admin`, requestId: `${PREFIX}-activate-paid` },
    });
    await createActivePaidPeriod(account.id);
    await prisma.$transaction((tx) => markMigrationPurchasedInTransaction(tx, account.id, `${PREFIX}-purchase`));
    await expect(prisma.billingMigrationAccess.findUniqueOrThrow({ where: { billingAccountId: account.id } }))
      .resolves.toMatchObject({ status: 'PURCHASED' });
    const [assigned, unassigned] = await prisma.$transaction(async (tx) => Promise.all([
      resolveDivisionAccessShadowInTransaction(tx, { divisionId: DIVISION_IDS[0], actor: { id: USER_ID, rol: 'LIGA' } }),
      resolveDivisionAccessShadowInTransaction(tx, { divisionId: DIVISION_IDS[1], actor: { id: USER_ID, rol: 'LIGA' } }),
    ]));
    expect(assigned).toMatchObject({ access: 'FULL', reason: 'PAID_ASSIGNED', basis: 'PAID' });
    expect(unassigned).toMatchObject({ access: 'FULL', reason: 'MIGRATION', basis: 'MIGRATION' });

    const purchased = await prisma.billingMigrationAccess.findUniqueOrThrow({ where: { billingAccountId: account.id } });
    await expect(prisma.$transaction((tx) => applyExpiredBillingMigrationInTransaction(tx, {
      migrationId: purchased.id, now: new Date(purchased.deadline!.getTime() + 1),
    }))).resolves.toBe(true);
    await expect(prisma.freeManagementGrant.count({ where: { billingAccountId: account.id } })).resolves.toBe(0);
    await expect(prisma.billingAuditLog.findFirstOrThrow({
      where: { action: 'BILLING_MIGRATION_APPLIED', targetId: `${PREFIX}-access` },
    })).resolves.toMatchObject({ metadataRedacted: expect.objectContaining({ paidAtDeadline: true, grantCreated: false }) });
  }, 30_000);

  test('rolls back PURCHASED and its audit when the materialization transaction fails', async () => {
    const { account } = await setupPreparedMigration();
    await activateMigrationFixture({
      billingAccountId: account.id, reason: 'Approve rollback integration migration',
      actor: { userId: `${PREFIX}-admin`, requestId: `${PREFIX}-activate-rollback` },
    });
    await expect(prisma.$transaction(async (tx) => {
      await markMigrationPurchasedInTransaction(tx, account.id, `${PREFIX}-purchase-rollback`);
      throw new Error('force materialization rollback');
    })).rejects.toThrow('force materialization rollback');
    await expect(prisma.billingMigrationAccess.findUniqueOrThrow({ where: { billingAccountId: account.id } }))
      .resolves.toMatchObject({ status: 'SELECTION_REQUIRED' });
    await expect(prisma.billingAuditLog.count({ where: { requestId: `${PREFIX}-purchase-rollback` } }))
      .resolves.toBe(0);
  }, 30_000);

  test('expires an explicit selection to exactly one MIGRATION_SELECTION grant', async () => {
    const { account } = await setupPreparedMigration();
    await activateMigrationFixture({
      billingAccountId: account.id, reason: 'Approve selected migration integration',
      actor: { userId: `${PREFIX}-admin`, requestId: `${PREFIX}-activate-selected` },
    });
    await selectMigrationFreeDivision({
      userId: USER_ID, divisionIdSnapshot: DIVISION_IDS[1], requestId: `${PREFIX}-select-expiry`,
    });
    const selected = await prisma.billingMigrationAccess.findUniqueOrThrow({ where: { billingAccountId: account.id } });
    const expiryNow = new Date(selected.deadline!.getTime() + 1);
    await expect(prisma.$transaction((tx) => applyExpiredBillingMigrationInTransaction(tx, {
      migrationId: selected.id, now: expiryNow,
    }))).resolves.toBe(true);
    await expect(prisma.$transaction((tx) => applyExpiredBillingMigrationInTransaction(tx, {
      migrationId: selected.id, now: expiryNow,
    }))).resolves.toBe(false);
    await expect(prisma.freeManagementGrant.findMany({ where: { billingAccountId: account.id } }))
      .resolves.toEqual([expect.objectContaining({ source: 'MIGRATION_SELECTION', divisionId: DIVISION_IDS[1] })]);
  }, 30_000);

  test('falls back deterministically when the explicitly selected division was deleted', async () => {
    const { account } = await setupPreparedMigration();
    await activateMigrationFixture({
      billingAccountId: account.id, reason: 'Approve deleted selection integration migration',
      actor: { userId: `${PREFIX}-admin`, requestId: `${PREFIX}-activate-deleted-selection` },
    });
    await selectMigrationFreeDivision({
      userId: USER_ID, divisionIdSnapshot: DIVISION_IDS[1], requestId: `${PREFIX}-select-before-delete`,
    });
    await prisma.division.delete({ where: { id: DIVISION_IDS[1] } });
    const selected = await prisma.billingMigrationAccess.findUniqueOrThrow({ where: { billingAccountId: account.id } });
    await expect(prisma.$transaction((tx) => applyExpiredBillingMigrationInTransaction(tx, {
      migrationId: selected.id, now: new Date(selected.deadline!.getTime() + 1),
    }))).resolves.toBe(true);
    await expect(prisma.freeManagementGrant.findMany({ where: { billingAccountId: account.id } }))
      .resolves.toEqual([expect.objectContaining({ source: 'MIGRATION_FALLBACK', divisionId: DIVISION_IDS[0] })]);
  }, 30_000);

  test('expires idempotently to a fallback grant when no selection or paid access exists', async () => {
    const { migration } = await setupPreparedMigration();
    const now = new Date();
    await prisma.billingMigrationAccess.update({
      where: { id: migration.id },
      data: {
        status: 'SELECTION_REQUIRED', startedAt: new Date(now.getTime() - 31 * 86_400_000),
        activatedAt: new Date(now.getTime() - 31 * 86_400_000), deadline: new Date(now.getTime() - 86_400_000),
      },
    });
    await expect(processBillingMigrationExpirations()).resolves.toMatchObject({ processedCount: 1 });
    await expect(processBillingMigrationExpirations()).resolves.toMatchObject({ processedCount: 0 });
    await expect(prisma.billingMigrationAccess.findUniqueOrThrow({ where: { id: migration.id } }))
      .resolves.toMatchObject({ status: 'APPLIED', appliedAt: expect.any(Date) });
    await expect(prisma.freeManagementGrant.findMany({ where: { billingAccountId: migration.billingAccountId } }))
      .resolves.toEqual([expect.objectContaining({ source: 'MIGRATION_FALLBACK', divisionId: DIVISION_IDS[0] })]);
  }, 30_000);
});
