import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { prisma } from '../../config/database';
import type { BillingAuditAction, BillingEnvironment, Prisma, PrismaClient } from '../../generated/prisma/client';
import { AppError, ConflictError, NotFoundError } from '../../utils/errors';
import { configureRawQuerySchema } from '../../utils/rawDatabaseSchema';
import { signalBackgroundJob } from '../../workers/jobSignals';
import {
  acquireMigrationReviewLock,
  evaluateBillingMigrationActivationEligibility,
  migrationActivationReviewInternals,
} from './migrationActivationReviewService';
import { acquireBillingAccountLock } from './service';
import { resolvePaidAccessShadowInTransaction } from './paidAccessShadow';

const MIGRATION_DAYS = 30;

export function currentBillingEnvironment(): BillingEnvironment {
  return env.APP_ENV === 'production' ? 'PRODUCTION' : 'PREVIEW';
}

async function audit(
  tx: Prisma.TransactionClient,
  input: {
    action: BillingAuditAction;
    migrationId: string;
    actorType: 'USER' | 'SYSTEM';
    actorUserIdSnapshot: string;
    requestId: string;
    reason?: string;
    metadata?: Prisma.InputJsonObject;
  },
) {
  await tx.billingAuditLog.create({
    data: {
      action: input.action,
      actorType: input.actorType,
      actorUserId: input.actorType === 'USER' ? input.actorUserIdSnapshot : undefined,
      actorUserIdSnapshot: input.actorUserIdSnapshot,
      targetType: 'BillingMigrationAccess',
      targetId: input.migrationId,
      requestId: input.requestId,
      reason: input.reason,
      metadataRedacted: input.metadata ?? {},
    },
  });
}

export async function activateBillingMigration(input: {
  billingAccountId: string;
  actor: { userId: string; requestId: string };
  reason: string;
  reviewId: string;
  idempotencyKey: string;
}, client: PrismaClient = prisma) {
  const requestFingerprint = migrationActivationReviewInternals.requestFingerprint({
    billingAccountId: input.billingAccountId,
    reviewId: input.reviewId,
    reason: input.reason,
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await client.$transaction(async (tx) => {
        await configureRawQuerySchema(tx);
        await acquireMigrationReviewLock(tx, input.reviewId);
        await acquireBillingAccountLock(tx, input.billingAccountId);
        const review = await tx.billingMigrationActivationReview.findUnique({
          where: { id: input.reviewId },
          include: {
            items: {
              where: { billingAccountId: input.billingAccountId },
              select: {
                id: true, migrationAccessId: true, stateFingerprint: true,
                eligibilityStatus: true, activatedAt: true,
              },
            },
          },
        });
        if (!review) throw new NotFoundError('Review de activación migratoria');
        const item = review.items[0];
        if (!item) {
          throw new AppError(409, 'La cuenta no pertenece al review', 'BILLING_MIGRATION_ACCOUNT_NOT_IN_REVIEW');
        }
        const migration = await tx.billingMigrationAccess.findUnique({
          where: { billingAccountId: input.billingAccountId },
        });
        if (!migration || item.migrationAccessId !== migration.id) {
          throw new AppError(409, 'La preparación migratoria cambió desde el review', 'BILLING_MIGRATION_REVIEW_STALE');
        }
        const existingAudit = await tx.billingAuditLog.findFirst({
          where: {
            actorUserIdSnapshot: input.actor.userId,
            action: 'BILLING_MIGRATION_ACTIVATED',
            targetType: 'BillingMigrationAccess', targetId: migration.id,
            idempotencyKey: input.idempotencyKey,
          },
          select: { requestFingerprint: true },
        });
        if (existingAudit) {
          if (existingAudit.requestFingerprint !== requestFingerprint) {
            throw new ConflictError('Idempotency-Key ya fue utilizada con otra solicitud');
          }
          return { migration, outcome: 'ALREADY_ACTIVATED' as const, newlyActivated: false };
        }
        const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
        if (!['APPROVED', 'COMPLETED'].includes(review.status)) {
          throw new AppError(409, 'El review no está aprobado', 'BILLING_MIGRATION_REVIEW_NOT_APPROVED');
        }
        if (review.expiresAt <= now) {
          throw new AppError(409, 'El review expiró', 'BILLING_MIGRATION_REVIEW_EXPIRED');
        }
        if (review.environment !== currentBillingEnvironment()) {
          throw new AppError(409, 'El review pertenece a otro ambiente', 'BILLING_MIGRATION_REVIEW_STALE');
        }
        if (migration.status !== 'PREPARED') {
          if (migration.activationReviewItemId === item.id && item.eligibilityStatus === 'ACTIVATED') {
            return { migration, outcome: 'ALREADY_ACTIVATED' as const, newlyActivated: false };
          }
          throw new AppError(409, 'La migración fue activada por otro flujo', 'BILLING_MIGRATION_ALREADY_ACTIVATED_BY_OTHER_REVIEW');
        }
        if (item.eligibilityStatus !== 'ELIGIBLE') {
          throw new AppError(409, 'La cuenta no está elegible en el review', 'BILLING_MIGRATION_REVIEW_STALE');
        }
        const control = await tx.billingOperationalControl.findUnique({
          where: { environment: currentBillingEnvironment() },
          select: { mode: true, version: true },
        });
        const openPause = await tx.billingOperationalPause.findFirst({
          where: { environment: currentBillingEnvironment(), endedAt: null }, select: { id: true },
        });
        const ready = await migrationActivationReviewInternals.purchasesReady(tx);
        if (control?.mode !== 'ENABLED' || openPause) {
          throw new AppError(409, 'Billing debe estar habilitado para activar la transición', 'BILLING_MIGRATION_ACTIVATION_PAUSED');
        }
        if (control.version !== review.operationalControlVersion || !ready) {
          throw new AppError(409, 'Las compras no están listas para activar la transición', 'BILLING_PURCHASES_NOT_READY');
        }
        const eligibility = await evaluateBillingMigrationActivationEligibility(tx, input.billingAccountId, {
          purchasesReady: ready, operationalEnabled: true, openPause: false,
        });
        if (eligibility.blockers.length > 0 || eligibility.stateFingerprint !== item.stateFingerprint) {
          await tx.billingMigrationActivationReview.update({
            where: { id: review.id }, data: { status: 'INVALIDATED', version: { increment: 1 } },
          });
          await tx.billingAuditLog.create({
            data: {
              action: 'BILLING_MIGRATION_ACTIVATION_REVIEW_INVALIDATED', actorType: 'USER',
              actorUserId: input.actor.userId, actorUserIdSnapshot: input.actor.userId,
              targetType: 'BILLING_MIGRATION_ACTIVATION_REVIEW', targetId: review.id,
              requestId: input.actor.requestId, reason: input.reason,
              metadataRedacted: { blockerCodes: eligibility.blockers },
            },
          });
          return {
            migration,
            outcome: 'BLOCKED' as const,
            newlyActivated: false,
            error: new AppError(409, 'La cuenta cambió desde el review', 'BILLING_MIGRATION_REVIEW_STALE'),
          };
        }
        const deadline = new Date(now.getTime() + MIGRATION_DAYS * 86_400_000);
        const activated = await tx.billingMigrationAccess.update({
          where: { id: migration.id },
          data: {
            status: 'SELECTION_REQUIRED', startedAt: now, activatedAt: now, deadline,
            activationReviewItemId: item.id,
          },
        });
        await tx.billingMigrationActivationReviewItem.update({
          where: { id: item.id },
          data: { eligibilityStatus: 'ACTIVATED', activatedAt: now },
        });
        await tx.billingAuditLog.create({
          data: {
            action: 'BILLING_MIGRATION_ACTIVATED', actorType: 'USER',
            actorUserId: input.actor.userId, actorUserIdSnapshot: input.actor.userId,
            targetType: 'BillingMigrationAccess', targetId: migration.id,
            requestId: input.actor.requestId, reason: input.reason,
            idempotencyKey: input.idempotencyKey, requestFingerprint,
            metadataRedacted: {
              reviewed: true, cohortSize: review.cohortCount,
              migrationDays: MIGRATION_DAYS, capturedDivisions: migration.preparedDivisionCount,
            },
          },
        });
        const pending = await tx.billingMigrationActivationReviewItem.count({
          where: { reviewId: review.id, eligibilityStatus: 'ELIGIBLE' },
        });
        if (pending === 0 && review.status === 'APPROVED') {
          await tx.billingMigrationActivationReview.update({
            where: { id: review.id }, data: { status: 'COMPLETED', version: { increment: 1 } },
          });
          await tx.billingAuditLog.create({
            data: {
              action: 'BILLING_MIGRATION_ACTIVATION_REVIEW_COMPLETED', actorType: 'SYSTEM',
              actorUserIdSnapshot: 'billing-migration-activation',
              targetType: 'BILLING_MIGRATION_ACTIVATION_REVIEW', targetId: review.id,
              requestId: input.actor.requestId, metadataRedacted: { cohortSize: review.cohortCount },
            },
          });
        }
        return { migration: activated, outcome: 'ACTIVATED' as const, newlyActivated: true };
      }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 30_000 });
      if ('error' in result) throw result.error;
      if (result.newlyActivated) signalBackgroundJob('billing-migration-expiry', result.migration.deadline ?? undefined);
      return { ...result.migration, outcome: result.outcome, reviewId: input.reviewId };
    } catch (error) {
      if ((error as { code?: unknown })?.code === 'P2034' && attempt < 2) continue;
      if ((error as { code?: unknown })?.code === 'P2034') {
        throw new ConflictError('La transición migratoria cambió durante la activación');
      }
      throw error;
    }
  }
  throw new ConflictError('La transición migratoria cambió durante la activación');
}

export async function selectMigrationFreeDivision(input: {
  userId: string;
  divisionIdSnapshot: string;
  requestId: string;
}, client: PrismaClient = prisma) {
  return client.$transaction(async (tx) => {
    const account = await tx.billingAccount.findUnique({ where: { userId: input.userId }, select: { id: true } });
    if (!account) throw new NotFoundError('Cuenta de billing');
    await acquireBillingAccountLock(tx, account.id);
    const migration = await tx.billingMigrationAccess.findUnique({
      where: { billingAccountId: account.id },
      include: { divisions: { where: { divisionIdSnapshot: input.divisionIdSnapshot }, select: { divisionId: true } } },
    });
    if (!migration || !['SELECTION_REQUIRED', 'SELECTED', 'PURCHASED'].includes(migration.status)) {
      throw new AppError(409, 'La selección migratoria no está disponible', 'BILLING_MIGRATION_SELECTION_UNAVAILABLE');
    }
    if (migration.selectedFreeDivisionIdSnapshot) {
      if (migration.selectedFreeDivisionIdSnapshot === input.divisionIdSnapshot) {
        const { divisions: _divisions, ...migrationRecord } = migration;
        return migrationRecord;
      }
      throw new ConflictError('La división gratuita de transición ya fue seleccionada');
    }
    const captured = migration.divisions[0];
    if (!captured?.divisionId) throw new AppError(422, 'La división seleccionada ya no está disponible', 'BILLING_MIGRATION_DIVISION_INVALID');
    const live = await tx.division.findFirst({
      where: { id: captured.divisionId, liga: { userId: input.userId } },
      select: { id: true },
    });
    if (!live) throw new AppError(422, 'La división seleccionada ya no pertenece a la cuenta', 'BILLING_MIGRATION_DIVISION_INVALID');
    const updated = await tx.billingMigrationAccess.update({
      where: { id: migration.id },
      data: {
        selectedFreeDivisionIdSnapshot: input.divisionIdSnapshot,
        ...(migration.status === 'SELECTION_REQUIRED' ? { status: 'SELECTED' as const } : {}),
      },
    });
    await audit(tx, {
      action: 'BILLING_MIGRATION_FREE_DIVISION_SELECTED', migrationId: migration.id,
      actorType: 'USER', actorUserIdSnapshot: input.userId, requestId: input.requestId,
      metadata: { selected: true },
    });
    return updated;
  }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 30_000 });
}

export async function markMigrationPurchasedInTransaction(
  tx: Prisma.TransactionClient,
  billingAccountId: string,
  requestId = randomUUID(),
): Promise<void> {
  const migration = await tx.billingMigrationAccess.findUnique({ where: { billingAccountId }, select: { id: true, status: true } });
  if (!migration || !['SELECTION_REQUIRED', 'SELECTED'].includes(migration.status)) return;
  await tx.billingMigrationAccess.update({ where: { id: migration.id }, data: { status: 'PURCHASED' } });
  await audit(tx, {
    action: 'BILLING_MIGRATION_PURCHASED', migrationId: migration.id,
    actorType: 'SYSTEM', actorUserIdSnapshot: 'billing-materialization', requestId,
    metadata: { paidAccessMaterialized: true },
  });
}

export async function applyExpiredBillingMigrationInTransaction(
  tx: Prisma.TransactionClient,
  input: { migrationId: string; now: Date },
): Promise<boolean> {
  const migration = await tx.billingMigrationAccess.findUnique({
    where: { id: input.migrationId },
    include: {
      billingAccount: { select: { id: true, userId: true } },
      divisions: { orderBy: [{ divisionCreatedAtSnapshot: 'asc' }, { divisionIdSnapshot: 'asc' }] },
    },
  });
  if (!migration || ['PREPARED', 'APPLIED', 'REPLACED'].includes(migration.status)
    || !migration.deadline || migration.deadline > input.now) return false;
  const openPause = await tx.billingOperationalPause.findFirst({
    where: { environment: currentBillingEnvironment(), endedAt: null }, select: { id: true },
  });
  if (openPause) return false;

  const paid = await resolvePaidAccessShadowInTransaction(migration.billingAccountId, tx);
  if (paid.state === 'BLOCKED') {
    throw new AppError(409, 'La evidencia de billing no permite finalizar la transición', 'BILLING_EVIDENCE_INVALID');
  }
  let grantCreated = false;
  if (paid.state !== 'PAID' && paid.state !== 'LOCAL_GRACE' && migration.billingAccount.userId) {
    const ordered = migration.selectedFreeDivisionIdSnapshot
      ? [...migration.divisions].sort((left, right) => Number(right.divisionIdSnapshot === migration.selectedFreeDivisionIdSnapshot)
        - Number(left.divisionIdSnapshot === migration.selectedFreeDivisionIdSnapshot))
      : migration.divisions;
    for (const snapshot of ordered) {
      if (!snapshot.divisionId) continue;
      const division = await tx.division.findFirst({
        where: { id: snapshot.divisionId, liga: { userId: migration.billingAccount.userId } },
        select: { id: true, nombre: true, liga: { select: { id: true, nombre: true } } },
      });
      if (!division) continue;
      const activeGrant = await tx.freeManagementGrant.findFirst({
        where: { billingAccountId: migration.billingAccountId, endedAt: null }, select: { id: true },
      });
      if (!activeGrant) {
        await tx.freeManagementGrant.create({
          data: {
            userId: migration.billingAccount.userId,
            billingAccountId: migration.billingAccountId,
            divisionId: division.id,
            divisionIdSnapshot: snapshot.divisionIdSnapshot,
            divisionNameSnapshot: division.nombre,
            leagueId: division.liga.id,
            leagueIdSnapshot: division.liga.id,
            leagueNameSnapshot: division.liga.nombre,
            source: snapshot.divisionIdSnapshot === migration.selectedFreeDivisionIdSnapshot
              ? 'MIGRATION_SELECTION' : 'MIGRATION_FALLBACK',
            grantedAt: input.now,
            sourceBillingMigrationAccessId: migration.id,
          },
        });
        grantCreated = true;
      }
      break;
    }
  }
  await tx.billingMigrationAccess.update({
    where: { id: migration.id }, data: { status: 'APPLIED', appliedAt: input.now },
  });
  await audit(tx, {
    action: 'BILLING_MIGRATION_APPLIED', migrationId: migration.id,
    actorType: 'SYSTEM', actorUserIdSnapshot: 'billing-migration-expiry', requestId: randomUUID(),
    metadata: { grantCreated, paidAtDeadline: paid.state === 'PAID' || paid.state === 'LOCAL_GRACE' },
  });
  return true;
}

export const migrationLifecycleInternals = { MIGRATION_DAYS };
