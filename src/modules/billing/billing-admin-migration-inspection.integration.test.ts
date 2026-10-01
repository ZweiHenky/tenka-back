import { afterEach, describe, expect, test } from 'vitest';
import { prisma } from '../../config/database';
import { truncateIntegrationBillingData } from '../../test/integration/cleanup';
import { ensureBillingAccount } from './service';
import {
  getAdminBillingMigration,
  getAdminBillingMigrationSummary,
  listAdminBillingMigrations,
} from './adminMigrationService';

const PREFIX = 'it-billing-admin-migration';
const USER_IDS = [`${PREFIX}-prepared-user`, `${PREFIX}-selected-user`, `${PREFIX}-purchased-user`];

afterEach(async () => {
  await prisma.$transaction((tx) => truncateIntegrationBillingData(tx));
  await prisma.division.deleteMany({ where: { id: { startsWith: `${PREFIX}-division-` } } });
  await prisma.liga.deleteMany({ where: { id: { startsWith: `${PREFIX}-league-` } } });
  await prisma.ubicacion.deleteMany({ where: { id: `${PREFIX}-location` } });
  await prisma.categoria.deleteMany({ where: { id: `${PREFIX}-category` } });
  await prisma.tipo.deleteMany({ where: { id: `${PREFIX}-type` } });
  await prisma.estadoLiga.deleteMany({ where: { id: `${PREFIX}-status` } });
  await prisma.tipoCompetencia.deleteMany({ where: { id: `${PREFIX}-competition` } });
  await prisma.user.deleteMany({ where: { id: { in: USER_IDS } } });
});

async function createAccount(userId: string) {
  await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, rol: 'LIGA' } });
  return prisma.$transaction((tx) => ensureBillingAccount(tx, userId));
}

async function setupDomainCatalogs() {
  await prisma.ubicacion.create({
    data: { id: `${PREFIX}-location`, lat: 0, lng: 0, nombreCompleto: 'Test', estado: 'Test', municipio: 'Test', timeZone: 'UTC' },
  });
  await Promise.all([
    prisma.categoria.create({ data: { id: `${PREFIX}-category`, nombre: PREFIX } }),
    prisma.tipo.create({ data: { id: `${PREFIX}-type`, nombre: PREFIX } }),
    prisma.estadoLiga.create({ data: { id: `${PREFIX}-status`, nombre: PREFIX, codigo: 'EN_CURSO' } }),
    prisma.tipoCompetencia.create({ data: { id: `${PREFIX}-competition`, nombre: PREFIX, codigo: 'LIGA_Y_ELIMINATORIAS' } }),
  ]);
}

async function createCapturedDivisions(userId: string, label: string, count: number) {
  const leagueId = `${PREFIX}-league-${label}`;
  await prisma.liga.create({
    data: {
      id: leagueId, nombre: `League ${label}`, nombreNormalizado: `${PREFIX}-${label}`,
      descripcion: 'Test', userId, ubicacionId: `${PREFIX}-location`,
    },
  });
  const divisions = [];
  for (let index = 0; index < count; index += 1) {
    divisions.push(await prisma.division.create({
      data: {
        id: `${PREFIX}-division-${label}-${index}`, nombre: `Division ${label} ${index}`, maxEquipos: 8,
        ligaId: leagueId, categoriaId: `${PREFIX}-category`, tipoId: `${PREFIX}-type`,
        estadoLigaId: `${PREFIX}-status`, tipoCompetenciaId: `${PREFIX}-competition`,
      },
      select: { id: true, createdAt: true, ligaId: true },
    }));
  }
  return divisions;
}

describe('billing migration admin inspection', () => {
  test('returns redacted summary, filtered pages and audited detail diagnostics', async () => {
    await setupDomainCatalogs();
    const [preparedAccount, selectedAccount, purchasedAccount] = await Promise.all(
      USER_IDS.map((userId) => createAccount(userId)),
    );
    const [preparedDivisions, selectedDivisions, purchasedDivisions] = await Promise.all([
      createCapturedDivisions(USER_IDS[0], 'prepared', 2),
      createCapturedDivisions(USER_IDS[1], 'selected', 2),
      createCapturedDivisions(USER_IDS[2], 'purchased', 2),
    ]);
    const now = new Date();
    await prisma.billingMigrationAccess.create({
      data: {
        id: `${PREFIX}-prepared`, billingAccountId: preparedAccount.id, status: 'PREPARED',
        preparedAt: new Date(now.getTime() - 3 * 86_400_000), preparedDivisionCount: 2,
        divisions: {
          create: preparedDivisions.map((division, index) => ({
            id: `${PREFIX}-prepared-snapshot-${index}`, divisionId: division.id, divisionIdSnapshot: division.id,
            divisionCreatedAtSnapshot: division.createdAt, leagueIdSnapshot: division.ligaId,
          })),
        },
      },
    });
    const selected = await prisma.billingMigrationAccess.create({
      data: {
        id: `${PREFIX}-selected`, billingAccountId: selectedAccount.id, status: 'SELECTION_REQUIRED',
        preparedAt: new Date(now.getTime() - 2 * 86_400_000), preparedDivisionCount: 2,
        startedAt: new Date(now.getTime() - 32 * 86_400_000),
        activatedAt: new Date(now.getTime() - 32 * 86_400_000),
        deadline: new Date(now.getTime() - 2 * 86_400_000),
        divisions: {
          create: selectedDivisions.map((division, index) => ({
            id: `${PREFIX}-selected-snapshot-${index}`, divisionId: division.id, divisionIdSnapshot: division.id,
            divisionCreatedAtSnapshot: division.createdAt, leagueIdSnapshot: division.ligaId,
          })),
        },
      },
    });
    await prisma.billingMigrationAccess.update({
      where: { id: selected.id },
      data: { status: 'SELECTED', selectedFreeDivisionIdSnapshot: selectedDivisions[1].id },
    });
    await prisma.billingMigrationAccess.create({
      data: {
        id: `${PREFIX}-purchased`, billingAccountId: purchasedAccount.id, status: 'PURCHASED',
        preparedAt: new Date(now.getTime() - 86_400_000), preparedDivisionCount: 2,
        startedAt: new Date(now.getTime() - 86_400_000), activatedAt: new Date(now.getTime() - 86_400_000),
        deadline: new Date(now.getTime() + 29 * 86_400_000),
        divisions: {
          create: purchasedDivisions.map((division, index) => ({
            id: `${PREFIX}-purchased-snapshot-${index}`, divisionId: division.id,
            divisionIdSnapshot: division.id, divisionCreatedAtSnapshot: division.createdAt,
            leagueIdSnapshot: division.ligaId,
          })),
        },
      },
    });
    const pause = await prisma.billingOperationalPause.create({
      data: {
        id: `${PREFIX}-pause`, environment: 'PREVIEW',
        startedAt: new Date(now.getTime() - 4 * 86_400_000), endedAt: new Date(now.getTime() - 3 * 86_400_000),
        startedByAdminId: `${PREFIX}-admin`, endedByAdminId: `${PREFIX}-admin`, reason: 'Integration diagnostics',
      },
    });
    await prisma.billingMigrationPauseApplication.create({
      data: {
        id: `${PREFIX}-pause-application`, billingMigrationAccessId: selected.id,
        billingOperationalPauseId: pause.id, extensionSeconds: 2,
        extensionMilliseconds: 1_234n, appliedAt: pause.endedAt!,
      },
    });
    await prisma.billingAuditLog.create({
      data: {
        id: `${PREFIX}-lifecycle-audit`, action: 'BILLING_MIGRATION_ACTIVATED', actorType: 'USER',
        actorUserId: `${PREFIX}-admin`, actorUserIdSnapshot: `${PREFIX}-admin`,
        targetType: 'BillingMigrationAccess', targetId: selected.id,
        requestId: `${PREFIX}-lifecycle-request`,
        metadataRedacted: { migrationDays: 30, capturedDivisions: 2, leakedValue: 'must-not-return' },
      },
    });
    await prisma.division.deleteMany({ where: { id: { startsWith: `${PREFIX}-division-` } } });

    const summary = await getAdminBillingMigrationSummary({
      userId: `${PREFIX}-admin`, requestId: `${PREFIX}-summary-request`,
    });
    expect(summary).toMatchObject({
      total: 3,
      byStatus: { PREPARED: 1, SELECTED: 1, PURCHASED: 1 },
      activeLifecycleCount: 2,
      overduePendingApplicationCount: 1,
      preparedDivisionCountTotal: 6,
      liveDivisionSnapshotCount: 0,
      deletedDivisionSnapshotCount: 6,
      operationalPause: { active: false, startedAt: null },
    });
    expect(summary.nextDeadlineAt).toEqual(expect.any(Date));

    const overdue = await listAdminBillingMigrations({
      status: ['SELECTED'], deadline: 'OVERDUE', limit: 25,
    }, { userId: `${PREFIX}-admin`, requestId: `${PREFIX}-list-overdue-request` });
    expect(overdue).toMatchObject({
      nextCursor: null,
      items: [expect.objectContaining({
        id: selected.id, billingAccountId: selectedAccount.id, lifecyclePhase: 'OVERDUE_PENDING_APPLICATION',
        liveDivisionCount: 0, deletedDivisionCount: 2, pauseApplicationCount: 1,
      })],
    });
    const firstPage = await listAdminBillingMigrations({
      status: ['PREPARED', 'SELECTED', 'PURCHASED', 'APPLIED', 'REPLACED', 'SELECTION_REQUIRED'], limit: 1,
    }, { userId: `${PREFIX}-admin`, requestId: `${PREFIX}-list-page-request` });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toBe(firstPage.items[0].id);

    const detail = await getAdminBillingMigration(selectedAccount.id, {
      userId: `${PREFIX}-admin`, requestId: `${PREFIX}-detail-request`,
    });
    expect(detail).toMatchObject({
      id: selected.id,
      selectedFreeDivisionIdSnapshot: selectedDivisions[1].id,
      divisions: [
        expect.objectContaining({ attached: false, selected: false }),
        expect.objectContaining({ attached: false, selected: true }),
      ],
      pauseApplications: [expect.objectContaining({ extensionMilliseconds: '1234' })],
      auditTimeline: [expect.objectContaining({
        action: 'BILLING_MIGRATION_ACTIVATED',
        metadata: { migrationDays: 30, capturedDivisions: 2 },
      })],
    });
    expect(JSON.stringify(detail)).not.toContain('must-not-return');
    expect(JSON.stringify(detail)).not.toContain(`${USER_IDS[1]}@example.test`);
    await expect(getAdminBillingMigration(`${PREFIX}-missing-account`, {
      userId: `${PREFIX}-admin`, requestId: `${PREFIX}-missing-detail-request`,
    })).rejects.toMatchObject({ statusCode: 404 });
    await expect(prisma.billingAuditLog.count({
      where: { requestId: `${PREFIX}-missing-detail-request` },
    })).resolves.toBe(0);

    await expect(prisma.billingAuditLog.count({
      where: {
        requestId: { in: [
          `${PREFIX}-summary-request`, `${PREFIX}-list-overdue-request`,
          `${PREFIX}-list-page-request`, `${PREFIX}-detail-request`,
        ] },
      },
    })).resolves.toBe(4);
  }, 60_000);
});
