import { prisma } from '../../config/database';
import { Prisma, type BillingInterval, type PrismaClient } from '../../generated/prisma/client';
import { AppError, NotFoundError, ValidationError } from '../../utils/errors';
import { configureRawQuerySchema } from '../../utils/rawDatabaseSchema';
import { billingEnvironmentForApp, getActiveBillingCatalog } from './catalog';
import type { BillingPurchaseSelectionInput } from './purchaseSelectionValidator';
import { ensureBillingAccount } from './service';
import type { BillingPurchaseSelectionDto } from './types';

interface PurchaseSelectionActor {
  userId: string;
  requestId: string;
}

const selectionProjection = {
  id: true,
  logicalProductId: true,
  billingInterval: true,
  targetCapacity: true,
  status: true,
  version: true,
  lockedAt: true,
  createdAt: true,
  updatedAt: true,
  items: {
    orderBy: { slotNumber: 'asc' as const },
    select: { slotNumber: true, divisionIdSnapshot: true },
  },
};

type SelectionProjection = Prisma.BillingPurchaseSelectionGetPayload<{ select: typeof selectionProjection }>;

function selectionConflict(message: string, code: string): AppError {
  return new AppError(409, message, code);
}

function dto(selection: SelectionProjection, freeDivisionIdSnapshot: string | null): BillingPurchaseSelectionDto {
  return {
    id: selection.id,
    logicalProductId: selection.logicalProductId,
    billingInterval: selection.billingInterval,
    targetCapacity: selection.targetCapacity,
    status: selection.status,
    version: selection.version,
    lockedAt: selection.lockedAt,
    items: selection.items.map((item) => ({
      slotNumber: item.slotNumber,
      divisionId: item.divisionIdSnapshot,
      fixedByFreeGrant: item.slotNumber === 1 && item.divisionIdSnapshot === freeDivisionIdSnapshot,
    })),
    createdAt: selection.createdAt,
    updatedAt: selection.updatedAt,
  };
}

async function assertLeagueActor(
  client: Pick<Prisma.TransactionClient, 'user'>,
  userId: string,
): Promise<void> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { rol: true } });
  if (!user) throw new NotFoundError('Usuario');
  if (user.rol !== 'LIGA') throw new ValidationError('Solo una cuenta con rol LIGA puede preparar una compra');
}

async function activeFreeDivisionSnapshot(
  client: Pick<Prisma.TransactionClient, 'freeManagementGrant'>,
  billingAccountId: string,
): Promise<string | null> {
  const grant = await client.freeManagementGrant.findFirst({
    where: { billingAccountId, endedAt: null },
    select: { divisionId: true, divisionIdSnapshot: true },
  });
  if (!grant) return null;
  if (!grant.divisionId || grant.divisionId !== grant.divisionIdSnapshot) {
    throw selectionConflict('El grant gratuito activo debe repararse antes de preparar una compra', 'BILLING_FREE_GRANT_INVALID');
  }
  return grant.divisionIdSnapshot;
}

async function lockAndValidateDivisions(
  tx: Prisma.TransactionClient,
  userId: string,
  divisionIds: string[],
): Promise<void> {
  if (divisionIds.length === 0) return;
  const divisions = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT division."id"
    FROM divisiones division
    JOIN ligas league ON league."id" = division."ligaId"
    WHERE division."id" IN (${Prisma.join(divisionIds)})
      AND league."userId" = ${userId}
    ORDER BY division."id"
    FOR UPDATE OF division
  `);
  if (divisions.length !== divisionIds.length) {
    throw new ValidationError('Una o más divisiones no existen o no pertenecen a la cuenta de billing');
  }
}

function resolveTarget(
  catalog: Awaited<ReturnType<typeof getActiveBillingCatalog>>,
  logicalProductId: string,
  billingInterval: BillingInterval,
): { logicalProductId: string; billingInterval: BillingInterval; targetCapacity: number } {
  if (!catalog.available || !catalog.release) {
    throw new AppError(503, 'El catálogo de billing activo no está disponible', 'BILLING_CATALOG_UNAVAILABLE');
  }
  const variants = catalog.release.products.filter((product) =>
    product.logicalProductId === logicalProductId && product.billingInterval === billingInterval,
  );
  const capacities = new Set(variants.map(({ capacity }) => capacity));
  if (variants.length === 0 || capacities.size !== 1) {
    throw new ValidationError('La variante de billing solicitada no existe en el catálogo activo');
  }
  return { logicalProductId, billingInterval, targetCapacity: variants[0].capacity };
}

export async function getBillingPurchaseSelection(
  userId: string,
  client: PrismaClient = prisma,
): Promise<BillingPurchaseSelectionDto | null> {
  await assertLeagueActor(client, userId);
  const account = await client.billingAccount.findUnique({ where: { userId }, select: { id: true } });
  if (!account) return null;
  const selection = await client.billingPurchaseSelection.findFirst({
    where: { billingAccountId: account.id, status: { in: ['DRAFT', 'LOCKED'] } },
    select: selectionProjection,
  });
  if (!selection) return null;
  const freeDivisionIdSnapshot = await activeFreeDivisionSnapshot(client, account.id);
  return dto(selection, freeDivisionIdSnapshot);
}

export async function putBillingPurchaseSelection(input: {
  selection: BillingPurchaseSelectionInput;
  actor: PurchaseSelectionActor;
}, client: PrismaClient = prisma): Promise<BillingPurchaseSelectionDto> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(async (tx) => {
        await configureRawQuerySchema(tx);
        await assertLeagueActor(tx, input.actor.userId);
        const account = await ensureBillingAccount(tx, input.actor.userId);
        await assertLeagueActor(tx, input.actor.userId);

        const catalog = await getActiveBillingCatalog(billingEnvironmentForApp(), tx);
        const target = resolveTarget(catalog, input.selection.logicalProductId, input.selection.billingInterval);
        const active = await tx.billingPurchaseSelection.findFirst({
          where: { billingAccountId: account.id, status: { in: ['DRAFT', 'LOCKED'] } },
          select: selectionProjection,
        });
        if (active?.status === 'LOCKED') {
          throw selectionConflict('La selección está bloqueada por un checkout en curso', 'BILLING_SELECTION_LOCKED');
        }
        if ((!active && input.selection.expectedVersion !== 0)
          || (active && active.version !== input.selection.expectedVersion)) {
          throw selectionConflict('La selección cambió; vuelve a cargar su estado', 'BILLING_SELECTION_CHANGED');
        }

        const freeDivisionIdSnapshot = await activeFreeDivisionSnapshot(tx, account.id);
        if (freeDivisionIdSnapshot && input.selection.divisionIds.includes(freeDivisionIdSnapshot)) {
          throw new ValidationError('La división gratuita ocupa automáticamente el slot 1 y no debe enviarse');
        }
        const availableEditableSlots = target.targetCapacity - (freeDivisionIdSnapshot ? 1 : 0);
        if (input.selection.divisionIds.length > availableEditableSlots) {
          throw new ValidationError('La selección contiene más divisiones que la capacidad objetivo');
        }
        const allDivisionIds = freeDivisionIdSnapshot
          ? [freeDivisionIdSnapshot, ...input.selection.divisionIds]
          : input.selection.divisionIds;
        await lockAndValidateDivisions(tx, input.actor.userId, allDivisionIds);
        const items = allDivisionIds.map((divisionIdSnapshot, index) => ({
          slotNumber: index + 1,
          divisionIdSnapshot,
        }));

        let saved: SelectionProjection;
        if (!active) {
          saved = await tx.billingPurchaseSelection.create({
            data: {
              billingAccountId: account.id,
              ...target,
              items: { createMany: { data: items } },
            },
            select: selectionProjection,
          });
          await tx.billingAuditLog.create({
            data: {
              action: 'BILLING_PURCHASE_SELECTION_CREATED',
              actorType: 'USER',
              actorUserId: input.actor.userId,
              actorUserIdSnapshot: input.actor.userId,
              targetType: 'BillingPurchaseSelection',
              targetId: saved.id,
              requestId: input.actor.requestId,
              metadataRedacted: {
                logicalProductId: target.logicalProductId,
                billingInterval: target.billingInterval,
                targetCapacity: target.targetCapacity,
                resultingVersion: saved.version,
                selectedCount: items.length,
                fixedFreeSlot: Boolean(freeDivisionIdSnapshot),
              } satisfies Prisma.InputJsonObject,
            },
          });
        } else if (active.logicalProductId !== target.logicalProductId
          || active.billingInterval !== target.billingInterval) {
          const superseded = await tx.billingPurchaseSelection.updateMany({
            where: { id: active.id, status: 'DRAFT', version: input.selection.expectedVersion },
            data: { status: 'SUPERSEDED', version: { increment: 1 } },
          });
          if (superseded.count !== 1) {
            throw selectionConflict('La selección cambió durante la actualización', 'BILLING_SELECTION_CHANGED');
          }
          await tx.billingAuditLog.create({
            data: {
              action: 'BILLING_PURCHASE_SELECTION_SUPERSEDED',
              actorType: 'USER',
              actorUserId: input.actor.userId,
              actorUserIdSnapshot: input.actor.userId,
              targetType: 'BillingPurchaseSelection',
              targetId: active.id,
              requestId: input.actor.requestId,
              metadataRedacted: { previousVersion: active.version, resultingVersion: active.version + 1 } satisfies Prisma.InputJsonObject,
            },
          });
          saved = await tx.billingPurchaseSelection.create({
            data: {
              billingAccountId: account.id,
              ...target,
              items: { createMany: { data: items } },
            },
            select: selectionProjection,
          });
          await tx.billingAuditLog.create({
            data: {
              action: 'BILLING_PURCHASE_SELECTION_CREATED',
              actorType: 'USER',
              actorUserId: input.actor.userId,
              actorUserIdSnapshot: input.actor.userId,
              targetType: 'BillingPurchaseSelection',
              targetId: saved.id,
              requestId: input.actor.requestId,
              metadataRedacted: {
                logicalProductId: target.logicalProductId,
                billingInterval: target.billingInterval,
                targetCapacity: target.targetCapacity,
                resultingVersion: saved.version,
                selectedCount: items.length,
                fixedFreeSlot: Boolean(freeDivisionIdSnapshot),
              } satisfies Prisma.InputJsonObject,
            },
          });
        } else {
          await tx.billingPurchaseSelectionItem.deleteMany({ where: { purchaseSelectionId: active.id } });
          if (items.length > 0) {
            await tx.billingPurchaseSelectionItem.createMany({
              data: items.map((item) => ({ ...item, purchaseSelectionId: active.id })),
            });
          }
          const updated = await tx.billingPurchaseSelection.updateMany({
            where: { id: active.id, status: 'DRAFT', version: input.selection.expectedVersion },
            data: { version: { increment: 1 } },
          });
          if (updated.count !== 1) {
            throw selectionConflict('La selección cambió durante la actualización', 'BILLING_SELECTION_CHANGED');
          }
          const reloaded = await tx.billingPurchaseSelection.findUnique({
            where: { id: active.id },
            select: selectionProjection,
          });
          if (!reloaded) throw new Error('billing_purchase_selection_missing_after_update');
          saved = reloaded;
          await tx.billingAuditLog.create({
            data: {
              action: 'BILLING_PURCHASE_SELECTION_UPDATED',
              actorType: 'USER',
              actorUserId: input.actor.userId,
              actorUserIdSnapshot: input.actor.userId,
              targetType: 'BillingPurchaseSelection',
              targetId: saved.id,
              requestId: input.actor.requestId,
              metadataRedacted: {
                previousVersion: active.version,
                resultingVersion: saved.version,
                selectedCount: items.length,
                fixedFreeSlot: Boolean(freeDivisionIdSnapshot),
              } satisfies Prisma.InputJsonObject,
            },
          });
        }
        return dto(saved, freeDivisionIdSnapshot);
      }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 30_000 });
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      if (code === 'P2034' && attempt < 2) continue;
      if (code === 'P2034' || code === 'P2002') {
        throw selectionConflict('La selección cambió durante la actualización', 'BILLING_SELECTION_CHANGED');
      }
      throw error;
    }
  }
  throw selectionConflict('La selección cambió durante la actualización', 'BILLING_SELECTION_CHANGED');
}
