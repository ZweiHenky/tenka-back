import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { prisma } from '../../config/database';
import { truncateIntegrationBillingData } from '../../test/integration/cleanup';
import { MX_2026_09_V1_CATALOG_MANIFEST } from './manifests/mx-2026-09-v1';
import { putBillingPurchaseSelection } from './purchaseSelectionService';
import { ensureBillingAccount } from './service';

const USER_ID = 'it-purchase-selection-user';
const OTHER_USER_ID = 'it-purchase-selection-other-user';
const PREFIX = 'it-purchase-selection';

async function ensureCatalog(): Promise<void> {
  const active = await prisma.billingCatalogRelease.findFirst({
    where: { environment: 'PREVIEW', status: 'ACTIVE' },
    select: { id: true },
  });
  if (active) return;
  await prisma.billingCatalogRelease.create({
    data: {
      id: `${PREFIX}-catalog`,
      version: `${PREFIX}-v1`,
      environment: 'PREVIEW',
      status: 'ACTIVE',
      approvedAt: new Date('2026-09-25T20:00:00Z'),
      activatedAt: new Date('2026-09-25T20:00:00Z'),
      products: {
        createMany: {
          data: MX_2026_09_V1_CATALOG_MANIFEST.products.map(({ id: _id, ...product }) => product),
        },
      },
    },
  });
}

async function setupDomain(): Promise<{
  accountId: string;
  divisions: [string, string, string];
  otherDivisionId: string;
}> {
  await prisma.user.createMany({
    data: [
      { id: USER_ID, email: `${USER_ID}@example.test`, rol: 'LIGA' },
      { id: OTHER_USER_ID, email: `${OTHER_USER_ID}@example.test`, rol: 'LIGA' },
    ],
  });
  await prisma.ubicacion.create({
    data: {
      id: `${PREFIX}-location`, lat: 0, lng: 0, nombreCompleto: 'Test',
      estado: 'Test', municipio: 'Test', timeZone: 'UTC',
    },
  });
  await Promise.all([
    prisma.categoria.create({ data: { id: `${PREFIX}-category`, nombre: 'Billing Test' } }),
    prisma.tipo.create({ data: { id: `${PREFIX}-type`, nombre: 'Billing Test' } }),
    prisma.estadoLiga.create({ data: { id: `${PREFIX}-status`, nombre: 'Billing Test', codigo: 'EN_CURSO' } }),
    prisma.tipoCompetencia.create({
      data: { id: `${PREFIX}-competition`, nombre: 'Billing Test', codigo: 'LIGA_Y_ELIMINATORIAS' },
    }),
  ]);
  await prisma.liga.createMany({
    data: [
      {
        id: `${PREFIX}-league`, nombre: 'Liga selection', nombreNormalizado: `${PREFIX}-league`,
        descripcion: 'Test', userId: USER_ID, ubicacionId: `${PREFIX}-location`,
      },
      {
        id: `${PREFIX}-other-league`, nombre: 'Other selection', nombreNormalizado: `${PREFIX}-other-league`,
        descripcion: 'Test', userId: OTHER_USER_ID, ubicacionId: `${PREFIX}-location`,
      },
    ],
  });
  const divisions = [`${PREFIX}-division-a`, `${PREFIX}-division-b`, `${PREFIX}-division-c`] as const;
  await prisma.division.createMany({
    data: [
      ...divisions.map((id, index) => ({
        id, nombre: `Division ${index}`, maxEquipos: 8, ligaId: `${PREFIX}-league`,
        categoriaId: `${PREFIX}-category`, tipoId: `${PREFIX}-type`,
        estadoLigaId: `${PREFIX}-status`, tipoCompetenciaId: `${PREFIX}-competition`,
      })),
      {
        id: `${PREFIX}-other-division`, nombre: 'Other division', maxEquipos: 8,
        ligaId: `${PREFIX}-other-league`, categoriaId: `${PREFIX}-category`,
        tipoId: `${PREFIX}-type`, estadoLigaId: `${PREFIX}-status`,
        tipoCompetenciaId: `${PREFIX}-competition`,
      },
    ],
  });
  const account = await prisma.$transaction((tx) => ensureBillingAccount(tx, USER_ID));
  return { accountId: account.id, divisions: [...divisions], otherDivisionId: `${PREFIX}-other-division` };
}

async function cleanup(): Promise<void> {
  await prisma.$transaction((tx) => truncateIntegrationBillingData(tx));
  await prisma.division.deleteMany({ where: { id: { startsWith: `${PREFIX}-` } } });
  await prisma.liga.deleteMany({ where: { id: { startsWith: `${PREFIX}-` } } });
  await prisma.ubicacion.deleteMany({ where: { id: `${PREFIX}-location` } });
  await prisma.categoria.deleteMany({ where: { id: `${PREFIX}-category` } });
  await prisma.tipo.deleteMany({ where: { id: `${PREFIX}-type` } });
  await prisma.estadoLiga.deleteMany({ where: { id: `${PREFIX}-status` } });
  await prisma.tipoCompetencia.deleteMany({ where: { id: `${PREFIX}-competition` } });
  await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } });
}

beforeAll(ensureCatalog);
afterEach(cleanup);

describe('billing purchase selection', () => {
  test('creates, edits and supersedes a partial selection while reserving free slot one', async () => {
    const { accountId, divisions } = await setupDomain();
    await prisma.freeManagementGrant.create({
      data: {
        userId: USER_ID,
        billingAccountId: accountId,
        divisionId: divisions[0],
        divisionIdSnapshot: divisions[0],
        divisionNameSnapshot: 'Division 0',
        leagueId: `${PREFIX}-league`,
        leagueIdSnapshot: `${PREFIX}-league`,
        leagueNameSnapshot: 'Liga selection',
        source: 'INITIAL_FREE',
      },
    });

    const created = await putBillingPurchaseSelection({
      selection: {
        logicalProductId: 'tenka_capacity_3', billingInterval: 'MONTHLY',
        divisionIds: [divisions[1]], expectedVersion: 0,
      },
      actor: { userId: USER_ID, requestId: `${PREFIX}-create` },
    });
    expect(created).toMatchObject({ targetCapacity: 3, status: 'DRAFT', version: 1 });
    expect(created.items).toEqual([
      { slotNumber: 1, divisionId: divisions[0], fixedByFreeGrant: true },
      { slotNumber: 2, divisionId: divisions[1], fixedByFreeGrant: false },
    ]);

    const edited = await putBillingPurchaseSelection({
      selection: {
        logicalProductId: 'tenka_capacity_3', billingInterval: 'MONTHLY',
        divisionIds: [divisions[2]], expectedVersion: 1,
      },
      actor: { userId: USER_ID, requestId: `${PREFIX}-edit` },
    });
    expect(edited).toMatchObject({ id: created.id, version: 2 });
    expect(edited.items.map(({ divisionId }) => divisionId)).toEqual([divisions[0], divisions[2]]);

    const replacement = await putBillingPurchaseSelection({
      selection: {
        logicalProductId: 'tenka_capacity_4', billingInterval: 'MONTHLY',
        divisionIds: [divisions[1], divisions[2]], expectedVersion: 2,
      },
      actor: { userId: USER_ID, requestId: `${PREFIX}-supersede` },
    });
    expect(replacement).toMatchObject({ targetCapacity: 4, status: 'DRAFT', version: 1 });
    await expect(prisma.billingPurchaseSelection.findUniqueOrThrow({ where: { id: created.id } }))
      .resolves.toMatchObject({ status: 'SUPERSEDED', version: 3 });
    expect(await prisma.billingAuditLog.count({
      where: {
        targetType: 'BillingPurchaseSelection',
        actorUserIdSnapshot: USER_ID,
        action: { in: [
          'BILLING_PURCHASE_SELECTION_CREATED',
          'BILLING_PURCHASE_SELECTION_UPDATED',
          'BILLING_PURCHASE_SELECTION_SUPERSEDED',
        ] },
      },
    })).toBe(4);
  }, 30_000);

  test('serializes concurrent creation and rejects foreign divisions', async () => {
    const { otherDivisionId } = await setupDomain();
    const input = {
      selection: {
        logicalProductId: 'tenka_capacity_2' as const,
        billingInterval: 'MONTHLY' as const,
        divisionIds: [] as string[],
        expectedVersion: 0,
      },
      actor: { userId: USER_ID, requestId: `${PREFIX}-concurrent` },
    };
    const results = await Promise.allSettled([
      putBillingPurchaseSelection(input),
      putBillingPurchaseSelection({ ...input, actor: { ...input.actor, requestId: `${PREFIX}-concurrent-2` } }),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);

    const active = await prisma.billingPurchaseSelection.findFirstOrThrow({ where: { status: 'DRAFT' } });
    await expect(putBillingPurchaseSelection({
      selection: {
        logicalProductId: 'tenka_capacity_2', billingInterval: 'MONTHLY',
        divisionIds: [otherDivisionId], expectedVersion: active.version,
      },
      actor: { userId: USER_ID, requestId: `${PREFIX}-foreign` },
    })).rejects.toThrow('no existen o no pertenecen');
    await expect(prisma.billingPurchaseSelection.findUniqueOrThrow({ where: { id: active.id } }))
      .resolves.toMatchObject({ version: active.version });
  }, 30_000);

  test('enforces active, capacity, transition and history constraints in PostgreSQL', async () => {
    const { accountId } = await setupDomain();
    const selection = await putBillingPurchaseSelection({
      selection: {
        logicalProductId: 'tenka_capacity_2', billingInterval: 'MONTHLY',
        divisionIds: [], expectedVersion: 0,
      },
      actor: { userId: USER_ID, requestId: `${PREFIX}-constraints` },
    });

    await expect(prisma.billingPurchaseSelection.create({
      data: {
        billingAccountId: accountId, logicalProductId: 'tenka_capacity_3',
        billingInterval: 'MONTHLY', targetCapacity: 3,
      },
    })).rejects.toThrow();
    await expect(prisma.billingPurchaseSelectionItem.create({
      data: {
        purchaseSelectionId: selection.id,
        slotNumber: 3,
        divisionIdSnapshot: `${PREFIX}-division-a`,
      },
    })).rejects.toThrow('slot exceeds target capacity');
    await expect(prisma.billingPurchaseSelection.update({
      where: { id: selection.id },
      data: { targetCapacity: 3, version: { increment: 1 } },
    })).rejects.toThrow('identity and target are immutable');
    await expect(prisma.billingPurchaseSelection.update({
      where: { id: selection.id },
      data: { version: 3 },
    })).rejects.toThrow('version must increase by one');
    await expect(prisma.billingPurchaseSelection.delete({ where: { id: selection.id } }))
      .rejects.toThrow('cannot be deleted');
  }, 30_000);
});
