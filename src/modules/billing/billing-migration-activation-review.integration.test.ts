import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { env } from '../../config/env';
import { prisma } from '../../config/database';
import { truncateIntegrationBillingData } from '../../test/integration/cleanup';
import { MX_2026_09_V1_CATALOG_MANIFEST } from './manifests/mx-2026-09-v1';
import { ensureBillingAccount } from './service';
import {
  approveBillingMigrationActivationReview,
  createBillingMigrationActivationReview,
} from './migrationActivationReviewService';
import { activateBillingMigration } from './migrationLifecycleService';

const PREFIX = 'it-billing-migration-review';
const USER_ID = `${PREFIX}-user`;
const ORIGINAL_FLAGS = {
  revenueCat: env.BILLING_REVENUECAT_ENABLED,
  materialization: env.BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED,
  shadow: env.BILLING_RESOURCE_ACCESS_SHADOW_ENABLED,
  purchases: env.BILLING_PURCHASES_ENABLED,
};

async function cleanup() {
  await prisma.$transaction((tx) => truncateIntegrationBillingData(tx));
  await prisma.billingProductCatalog.deleteMany({ where: { catalogReleaseId: `${PREFIX}-catalog` } });
  await prisma.billingCatalogRelease.deleteMany({ where: { id: `${PREFIX}-catalog` } });
  await prisma.division.deleteMany({ where: { id: { startsWith: `${PREFIX}-division` } } });
  await prisma.liga.deleteMany({ where: { id: { startsWith: `${PREFIX}-league` } } });
  await prisma.ubicacion.deleteMany({ where: { id: `${PREFIX}-location` } });
  await prisma.categoria.deleteMany({ where: { id: `${PREFIX}-category` } });
  await prisma.tipo.deleteMany({ where: { id: `${PREFIX}-type` } });
  await prisma.estadoLiga.deleteMany({ where: { id: `${PREFIX}-status` } });
  await prisma.tipoCompetencia.deleteMany({ where: { id: `${PREFIX}-competition` } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.billingOperationalControl.update({
    where: { environment: 'PREVIEW' },
    data: { mode: 'PURCHASES_PAUSED', reason: 'Integration cleanup', version: { increment: 1 } },
  });
  Object.assign(env, {
    BILLING_REVENUECAT_ENABLED: ORIGINAL_FLAGS.revenueCat,
    BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED: ORIGINAL_FLAGS.materialization,
    BILLING_RESOURCE_ACCESS_SHADOW_ENABLED: ORIGINAL_FLAGS.shadow,
    BILLING_PURCHASES_ENABLED: ORIGINAL_FLAGS.purchases,
  });
}

beforeEach(() => {
  Object.assign(env, {
    BILLING_REVENUECAT_ENABLED: true,
    BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED: true,
    BILLING_RESOURCE_ACCESS_SHADOW_ENABLED: true,
    BILLING_PURCHASES_ENABLED: true,
  });
});
afterEach(cleanup);

async function setupPreparedMigration() {
  await prisma.billingCatalogRelease.create({
    data: {
      id: `${PREFIX}-catalog`, version: `${PREFIX}-v1`, environment: 'PREVIEW', status: 'ACTIVE',
      approvedAt: new Date('2026-09-25T20:00:00Z'), activatedAt: new Date('2026-09-25T20:00:00Z'),
      products: {
        createMany: { data: MX_2026_09_V1_CATALOG_MANIFEST.products.map(({ id: _id, ...product }) => product) },
      },
    },
  });
  await prisma.user.create({ data: { id: USER_ID, email: `${USER_ID}@example.test`, rol: 'LIGA' } });
  const account = await prisma.$transaction((tx) => ensureBillingAccount(tx, USER_ID));
  await prisma.ubicacion.create({
    data: { id: `${PREFIX}-location`, lat: 0, lng: 0, nombreCompleto: 'Test', estado: 'Test', municipio: 'Test', timeZone: 'UTC' },
  });
  await Promise.all([
    prisma.categoria.create({ data: { id: `${PREFIX}-category`, nombre: PREFIX } }),
    prisma.tipo.create({ data: { id: `${PREFIX}-type`, nombre: PREFIX } }),
    prisma.estadoLiga.create({ data: { id: `${PREFIX}-status`, nombre: PREFIX, codigo: 'EN_CURSO' } }),
    prisma.tipoCompetencia.create({ data: { id: `${PREFIX}-competition`, nombre: PREFIX, codigo: 'LIGA_Y_ELIMINATORIAS' } }),
  ]);
  await prisma.liga.create({
    data: {
      id: `${PREFIX}-league`, nombre: 'Review league', nombreNormalizado: PREFIX,
      descripcion: 'Test', userId: USER_ID, ubicacionId: `${PREFIX}-location`,
    },
  });
  const divisions = [];
  for (let index = 0; index < 2; index += 1) {
    divisions.push(await prisma.division.create({
      data: {
        id: `${PREFIX}-division-${index}`, nombre: `Division ${index}`, maxEquipos: 8,
        ligaId: `${PREFIX}-league`, categoriaId: `${PREFIX}-category`, tipoId: `${PREFIX}-type`,
        estadoLigaId: `${PREFIX}-status`, tipoCompetenciaId: `${PREFIX}-competition`,
      },
      select: { id: true, createdAt: true, ligaId: true },
    }));
  }
  const [{ now }] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
  const migration = await prisma.billingMigrationAccess.create({
    data: {
      id: `${PREFIX}-migration`, billingAccountId: account.id, status: 'PREPARED',
      preparedAt: now, preparedDivisionCount: divisions.length,
      divisions: {
        create: divisions.map((division, index) => ({
          id: `${PREFIX}-snapshot-${index}`, divisionId: division.id, divisionIdSnapshot: division.id,
          divisionCreatedAtSnapshot: division.createdAt, leagueIdSnapshot: division.ligaId,
        })),
      },
    },
  });
  await prisma.billingOperationalControl.update({
    where: { environment: 'PREVIEW' },
    data: { mode: 'ENABLED', reason: 'Integration reviewed activation', version: { increment: 1 } },
  });
  return { account, migration };
}

describe('reviewed billing migration activation', () => {
  test('reviews, independently approves and activates one account idempotently', async () => {
    const { account, migration } = await setupPreparedMigration();
    const review = await createBillingMigrationActivationReview({
      review: { billingAccountIds: [account.id], reason: 'Review exact integration cohort' },
      idempotencyKey: `${PREFIX}-review-key`,
      actor: { userId: `${PREFIX}-admin-a`, requestId: `${PREFIX}-review-request` },
    });
    expect(review).toMatchObject({ status: 'PENDING_REVIEW', summary: { requested: 1, eligible: 1, blocked: 0 } });
    await expect(prisma.billingMigrationAccess.findUniqueOrThrow({ where: { id: migration.id } }))
      .resolves.toMatchObject({ status: 'PREPARED', activatedAt: null, deadline: null });
    await expect(approveBillingMigrationActivationReview({
      reviewId: review.id,
      approval: { expectedVersion: review.version, reason: 'Requester cannot self approve' },
      idempotencyKey: `${PREFIX}-self-approval-key`,
      actor: { userId: `${PREFIX}-admin-a`, requestId: `${PREFIX}-self-approval-request` },
    })).rejects.toMatchObject({ code: 'BILLING_MIGRATION_SECOND_APPROVER_REQUIRED' });

    const approved = await approveBillingMigrationActivationReview({
      reviewId: review.id,
      approval: { expectedVersion: review.version, reason: 'Independent administrator approved cohort' },
      idempotencyKey: `${PREFIX}-approval-key`,
      actor: { userId: `${PREFIX}-admin-b`, requestId: `${PREFIX}-approval-request` },
    });
    expect(approved).toMatchObject({ status: 'APPROVED', version: review.version + 1 });

    const activated = await activateBillingMigration({
      billingAccountId: account.id, reviewId: review.id, reason: 'Activate independently reviewed account',
      idempotencyKey: `${PREFIX}-activation-key`,
      actor: { userId: `${PREFIX}-admin-b`, requestId: `${PREFIX}-activation-request` },
    });
    expect(activated).toMatchObject({ status: 'SELECTION_REQUIRED', outcome: 'ACTIVATED', reviewId: review.id });
    expect(activated.startedAt).toEqual(activated.activatedAt);
    expect(activated.deadline!.getTime() - activated.startedAt!.getTime()).toBe(30 * 86_400_000);
    await expect(activateBillingMigration({
      billingAccountId: account.id, reviewId: review.id, reason: 'Activate independently reviewed account',
      idempotencyKey: `${PREFIX}-activation-key`,
      actor: { userId: `${PREFIX}-admin-b`, requestId: `${PREFIX}-activation-retry-request` },
    })).resolves.toMatchObject({ outcome: 'ALREADY_ACTIVATED', activatedAt: activated.activatedAt });
    await expect(prisma.billingMigrationActivationReview.findUniqueOrThrow({ where: { id: review.id } }))
      .resolves.toMatchObject({ status: 'COMPLETED' });
    await expect(prisma.billingMigrationActivationReviewItem.findFirstOrThrow({ where: { reviewId: review.id } }))
      .resolves.toMatchObject({ eligibilityStatus: 'ACTIVATED', activatedAt: expect.any(Date) });
    await expect(prisma.billingAuditLog.count({
      where: { action: 'BILLING_MIGRATION_ACTIVATED', targetId: migration.id },
    })).resolves.toBe(1);
  }, 60_000);

  test('persists invalidation when account state changes after approval', async () => {
    const { account } = await setupPreparedMigration();
    const review = await createBillingMigrationActivationReview({
      review: { billingAccountIds: [account.id], reason: 'Review cohort before state mutation' },
      idempotencyKey: `${PREFIX}-stale-review-key`,
      actor: { userId: `${PREFIX}-admin-a`, requestId: `${PREFIX}-stale-review-request` },
    });
    await approveBillingMigrationActivationReview({
      reviewId: review.id,
      approval: { expectedVersion: review.version, reason: 'Approve cohort before state mutation' },
      idempotencyKey: `${PREFIX}-stale-approval-key`,
      actor: { userId: `${PREFIX}-admin-b`, requestId: `${PREFIX}-stale-approval-request` },
    });
    await prisma.division.create({
      data: {
        id: `${PREFIX}-division-new`, nombre: 'New division', maxEquipos: 8,
        ligaId: `${PREFIX}-league`, categoriaId: `${PREFIX}-category`, tipoId: `${PREFIX}-type`,
        estadoLigaId: `${PREFIX}-status`, tipoCompetenciaId: `${PREFIX}-competition`,
      },
    });
    await expect(activateBillingMigration({
      billingAccountId: account.id, reviewId: review.id, reason: 'Attempt stale reviewed activation',
      idempotencyKey: `${PREFIX}-stale-activation-key`,
      actor: { userId: `${PREFIX}-admin-b`, requestId: `${PREFIX}-stale-activation-request` },
    })).rejects.toMatchObject({ code: 'BILLING_MIGRATION_REVIEW_STALE' });
    await expect(prisma.billingMigrationActivationReview.findUniqueOrThrow({ where: { id: review.id } }))
      .resolves.toMatchObject({ status: 'INVALIDATED' });
    await expect(prisma.billingMigrationAccess.findUniqueOrThrow({ where: { billingAccountId: account.id } }))
      .resolves.toMatchObject({ status: 'PREPARED', activatedAt: null });
  }, 60_000);

  test('creates a non-approvable blocked review when purchases are not ready', async () => {
    const { account } = await setupPreparedMigration();
    env.BILLING_PURCHASES_ENABLED = false;
    const review = await createBillingMigrationActivationReview({
      review: { billingAccountIds: [account.id], reason: 'Review blocked purchase readiness' },
      idempotencyKey: `${PREFIX}-blocked-review-key`,
      actor: { userId: `${PREFIX}-admin-a`, requestId: `${PREFIX}-blocked-review-request` },
    });
    expect(review).toMatchObject({
      status: 'BLOCKED', summary: { eligible: 0, blocked: 1 },
      items: [expect.objectContaining({ blockers: expect.arrayContaining(['PURCHASES_NOT_READY']) })],
    });
  }, 60_000);
});
