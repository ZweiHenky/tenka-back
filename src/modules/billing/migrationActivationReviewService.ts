import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../../config/database';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { AppError, ConflictError, NotFoundError } from '../../utils/errors';
import { configureRawQuerySchema } from '../../utils/rawDatabaseSchema';
import { billingEnvironmentForApp, getActiveBillingCatalog } from './catalog';
import { resolvePaidAccessShadowInTransaction } from './paidAccessShadow';
import type {
  BillingMigrationActivationReviewApprovalInput,
  BillingMigrationActivationReviewInput,
} from './migrationActivationReviewValidator';

const REVIEW_HOURS = 24;
function currentBillingEnvironment() {
  return billingEnvironmentForApp();
}
export const ACTIVATION_BLOCKER_CODES = [
  'MIGRATION_NOT_FOUND',
  'MIGRATION_NOT_PREPARED',
  'ACCOUNT_DETACHED',
  'OWNER_ROLE_INVALID',
  'CANONICAL_IDENTITY_INVALID',
  'SNAPSHOT_COUNT_MISMATCH',
  'LIVE_DIVISION_SET_CHANGED',
  'DIVISION_OWNERSHIP_CHANGED',
  'ACTIVE_FREE_GRANT',
  'CURRENT_PAID_OR_GRACE_ACCESS',
  'CONTRADICTORY_BILLING_EVIDENCE',
  'OPERATIONAL_CONTROL_NOT_ENABLED',
  'OPEN_OPERATIONAL_PAUSE',
  'PURCHASES_NOT_READY',
] as const;
export type ActivationBlockerCode = typeof ACTIVATION_BLOCKER_CODES[number];

interface AdminActor { userId: string; requestId: string }

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function requestFingerprint(value: unknown): string {
  return hash(value);
}

async function purchasesReady(tx: Prisma.TransactionClient): Promise<boolean> {
  try {
    const catalog = await getActiveBillingCatalog(currentBillingEnvironment(), tx as unknown as PrismaClient);
    return catalog.available && catalog.purchasesEnabled;
  } catch {
    return false;
  }
}

export interface ActivationEligibility {
  billingAccountId: string;
  migrationAccessId: string | null;
  preparedDivisionCount: number;
  liveDivisionCount: number;
  blockers: ActivationBlockerCode[];
  stateFingerprint: string;
}

export async function evaluateBillingMigrationActivationEligibility(
  tx: Prisma.TransactionClient,
  billingAccountId: string,
  readiness?: { purchasesReady: boolean; operationalEnabled: boolean; openPause: boolean },
): Promise<ActivationEligibility> {
  const environment = currentBillingEnvironment();
  const shared = readiness ?? await (async () => {
    const [control, pause, ready] = await Promise.all([
      tx.billingOperationalControl.findUnique({ where: { environment }, select: { mode: true } }),
      tx.billingOperationalPause.findFirst({ where: { environment, endedAt: null }, select: { id: true } }),
      purchasesReady(tx),
    ]);
    return { purchasesReady: ready, operationalEnabled: control?.mode === 'ENABLED', openPause: Boolean(pause) };
  })();
  const migration = await tx.billingMigrationAccess.findUnique({
    where: { billingAccountId },
    select: {
      id: true, status: true, preparedAt: true, preparedDivisionCount: true,
      selectedFreeDivisionIdSnapshot: true, startedAt: true, deadline: true, activatedAt: true, appliedAt: true,
      activationReviewItemId: true,
      divisions: {
        orderBy: [{ divisionCreatedAtSnapshot: 'asc' }, { divisionIdSnapshot: 'asc' }],
        select: { divisionId: true, divisionIdSnapshot: true, leagueIdSnapshot: true },
      },
      billingAccount: {
        select: {
          userId: true,
          user: {
            select: {
              rol: true,
              ligas: { select: { divisiones: { select: { id: true, ligaId: true } } } },
            },
          },
          providerIdentities: { select: { revenueCatAppUserId: true, kind: true, status: true } },
          freeGrants: { where: { endedAt: null }, select: { id: true } },
        },
      },
    },
  });
  const blockers: ActivationBlockerCode[] = [];
  if (!migration) blockers.push('MIGRATION_NOT_FOUND');
  if (migration && migration.status !== 'PREPARED') blockers.push('MIGRATION_NOT_PREPARED');
  const account = migration?.billingAccount;
  if (migration && (!account?.userId || !account.user)) blockers.push('ACCOUNT_DETACHED');
  if (account?.user && account.user.rol !== 'LIGA') blockers.push('OWNER_ROLE_INVALID');
  if (account) {
    const canonical = account.providerIdentities.filter((identity) => identity.kind === 'CANONICAL' && identity.status === 'ACTIVE');
    if (canonical.length !== 1 || canonical[0].revenueCatAppUserId !== billingAccountId) {
      blockers.push('CANONICAL_IDENTITY_INVALID');
    }
    if (account.freeGrants.length > 0) blockers.push('ACTIVE_FREE_GRANT');
  }
  const snapshots = migration?.divisions ?? [];
  const liveDivisions = account?.user?.ligas.flatMap((league) => league.divisiones) ?? [];
  if (migration && snapshots.length !== migration.preparedDivisionCount) blockers.push('SNAPSHOT_COUNT_MISMATCH');
  if (migration) {
    const snapshotIds = [...snapshots.map(({ divisionIdSnapshot }) => divisionIdSnapshot)].sort();
    const liveIds = [...liveDivisions.map(({ id }) => id)].sort();
    if (snapshotIds.length !== liveIds.length || snapshotIds.some((id, index) => id !== liveIds[index])) {
      blockers.push('LIVE_DIVISION_SET_CHANGED');
    }
    const ownershipChanged = snapshots.some((snapshot) => {
      const live = liveDivisions.find(({ id }) => id === snapshot.divisionIdSnapshot);
      return snapshot.divisionId !== snapshot.divisionIdSnapshot || !live || live.ligaId !== snapshot.leagueIdSnapshot;
    });
    if (ownershipChanged) blockers.push('DIVISION_OWNERSHIP_CHANGED');
  }
  if (migration) {
    const paid = await resolvePaidAccessShadowInTransaction(billingAccountId, tx);
    if (paid.state === 'PAID' || paid.state === 'LOCAL_GRACE') blockers.push('CURRENT_PAID_OR_GRACE_ACCESS');
    if (paid.state === 'BLOCKED') blockers.push('CONTRADICTORY_BILLING_EVIDENCE');
  }
  if (!shared.operationalEnabled) blockers.push('OPERATIONAL_CONTROL_NOT_ENABLED');
  if (shared.openPause) blockers.push('OPEN_OPERATIONAL_PAUSE');
  if (!shared.purchasesReady) blockers.push('PURCHASES_NOT_READY');
  const uniqueBlockers = [...new Set(blockers)];
  const fingerprintSource = {
    billingAccountId,
    migration: migration ? {
      id: migration.id,
      status: migration.status,
      preparedAt: migration.preparedAt.toISOString(),
      preparedDivisionCount: migration.preparedDivisionCount,
      selectedFreeDivisionIdSnapshot: migration.selectedFreeDivisionIdSnapshot,
      startedAt: migration.startedAt?.toISOString() ?? null,
      deadline: migration.deadline?.toISOString() ?? null,
      activatedAt: migration.activatedAt?.toISOString() ?? null,
      appliedAt: migration.appliedAt?.toISOString() ?? null,
      activationReviewItemId: migration.activationReviewItemId,
      snapshots: snapshots.map((snapshot) => ({
        divisionId: snapshot.divisionId,
        divisionIdSnapshot: snapshot.divisionIdSnapshot,
        leagueIdSnapshot: snapshot.leagueIdSnapshot,
      })),
    } : null,
    liveDivisions: liveDivisions.map(({ id, ligaId }) => ({ id, ligaId })).sort((a, b) => a.id.localeCompare(b.id)),
    identityHealthy: !uniqueBlockers.includes('CANONICAL_IDENTITY_INVALID'),
    activeFreeGrant: uniqueBlockers.includes('ACTIVE_FREE_GRANT'),
    paidState: uniqueBlockers.includes('CONTRADICTORY_BILLING_EVIDENCE') ? 'BLOCKED'
      : uniqueBlockers.includes('CURRENT_PAID_OR_GRACE_ACCESS') ? 'ACTIVE' : 'NONE',
    readiness: shared,
  };
  return {
    billingAccountId,
    migrationAccessId: migration?.id ?? null,
    preparedDivisionCount: migration?.preparedDivisionCount ?? 0,
    liveDivisionCount: liveDivisions.length,
    blockers: uniqueBlockers,
    stateFingerprint: hash(fingerprintSource),
  };
}

const REVIEW_INCLUDE = {
  items: { orderBy: { id: 'asc' as const } },
} satisfies Prisma.BillingMigrationActivationReviewInclude;

function reviewDto(review: Prisma.BillingMigrationActivationReviewGetPayload<{ include: typeof REVIEW_INCLUDE }>) {
  const counts = { eligible: 0, blocked: 0, activated: 0 };
  for (const item of review.items) {
    if (item.eligibilityStatus === 'ELIGIBLE') counts.eligible += 1;
    if (item.eligibilityStatus === 'BLOCKED') counts.blocked += 1;
    if (item.eligibilityStatus === 'ACTIVATED') counts.activated += 1;
  }
  return {
    id: review.id,
    environment: review.environment,
    status: review.status,
    cohortHash: review.cohortHash,
    requestedAt: review.requestedAt,
    approvedAt: review.approvedAt,
    expiresAt: review.expiresAt,
    operationalControlVersion: review.operationalControlVersion,
    version: review.version,
    summary: { requested: review.cohortCount, ...counts, pending: counts.eligible },
    items: review.items.map((item) => ({
      billingAccountId: item.billingAccountId,
      migrationAccessId: item.migrationAccessId,
      preparedDivisionCount: item.preparedDivisionCount,
      liveDivisionCount: item.liveDivisionCount,
      eligible: item.eligibilityStatus === 'ELIGIBLE',
      status: item.eligibilityStatus,
      blockers: item.blockerCodes,
      activatedAt: item.activatedAt,
    })),
  };
}

async function findIdempotentReview(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  idempotencyKey: string,
  fingerprint: string,
) {
  const audit = await tx.billingAuditLog.findFirst({
    where: {
      actorUserIdSnapshot: actorUserId,
      action: { in: ['BILLING_MIGRATION_ACTIVATION_REVIEW_CREATED', 'BILLING_MIGRATION_ACTIVATION_REVIEW_BLOCKED'] },
      targetType: 'BILLING_MIGRATION_ACTIVATION_REVIEW',
      idempotencyKey,
    },
    select: { targetId: true, requestFingerprint: true },
  });
  if (!audit) return null;
  if (audit.requestFingerprint !== fingerprint) throw new ConflictError('Idempotency-Key ya fue utilizada con otra solicitud');
  return tx.billingMigrationActivationReview.findUnique({ where: { id: audit.targetId }, include: REVIEW_INCLUDE });
}

export async function createBillingMigrationActivationReview(input: {
  review: BillingMigrationActivationReviewInput;
  idempotencyKey: string;
  actor: AdminActor;
}) {
  const sortedIds = [...input.review.billingAccountIds].sort();
  const fingerprint = requestFingerprint({ billingAccountIds: sortedIds, reason: input.review.reason });
  return prisma.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `billing-migration-review-create:${input.actor.userId}:${input.idempotencyKey}`,
    );
    const existing = await findIdempotentReview(tx, input.actor.userId, input.idempotencyKey, fingerprint);
    if (existing) return reviewDto(existing);
    const environment = currentBillingEnvironment();
    const [control, openPause, ready] = await Promise.all([
      tx.billingOperationalControl.findUnique({ where: { environment }, select: { mode: true, version: true } }),
      tx.billingOperationalPause.findFirst({ where: { environment, endedAt: null }, select: { id: true } }),
      purchasesReady(tx),
    ]);
    const readiness = {
      purchasesReady: ready,
      operationalEnabled: control?.mode === 'ENABLED',
      openPause: Boolean(openPause),
    };
    const items = [];
    for (const billingAccountId of sortedIds) {
      items.push(await evaluateBillingMigrationActivationEligibility(tx, billingAccountId, readiness));
    }
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
    const blocked = items.some((item) => item.blockers.length > 0);
    const id = `billing_migration_activation_review_${randomUUID()}`;
    const cohortHash = hash(items.map((item) => ({
      billingAccountId: item.billingAccountId, stateFingerprint: item.stateFingerprint,
    })));
    const created = await tx.billingMigrationActivationReview.create({
      data: {
        id, environment, status: blocked ? 'BLOCKED' : 'PENDING_REVIEW', cohortHash,
        cohortCount: items.length, reason: input.review.reason,
        requestedByAdminIdSnapshot: input.actor.userId, requestedAt: now,
        expiresAt: new Date(now.getTime() + REVIEW_HOURS * 3_600_000),
        operationalControlVersion: control?.version ?? 0,
        items: {
          create: items.map((item) => ({
            id: `billing_migration_activation_review_item_${randomUUID()}`,
            billingAccountId: item.billingAccountId,
            migrationAccessId: item.migrationAccessId,
            stateFingerprint: item.stateFingerprint,
            eligibilityStatus: item.blockers.length > 0 ? 'BLOCKED' : 'ELIGIBLE',
            blockerCodes: item.blockers,
            preparedDivisionCount: item.preparedDivisionCount,
            liveDivisionCount: item.liveDivisionCount,
          })),
        },
      },
      include: REVIEW_INCLUDE,
    });
    await tx.billingAuditLog.create({
      data: {
        action: blocked ? 'BILLING_MIGRATION_ACTIVATION_REVIEW_BLOCKED' : 'BILLING_MIGRATION_ACTIVATION_REVIEW_CREATED',
        actorType: 'USER', actorUserId: input.actor.userId, actorUserIdSnapshot: input.actor.userId,
        targetType: 'BILLING_MIGRATION_ACTIVATION_REVIEW', targetId: id,
        requestId: input.actor.requestId, reason: input.review.reason,
        idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint,
        metadataRedacted: {
          requested: items.length,
          eligible: items.filter((item) => item.blockers.length === 0).length,
          blocked: items.filter((item) => item.blockers.length > 0).length,
        },
      },
    });
    return reviewDto(created);
  }, { isolationLevel: 'RepeatableRead', maxWait: 5_000, timeout: 30_000 });
}

export async function getBillingMigrationActivationReview(reviewId: string, actor: AdminActor) {
  return prisma.$transaction(async (tx) => {
    const review = await tx.billingMigrationActivationReview.findUnique({ where: { id: reviewId }, include: REVIEW_INCLUDE });
    if (!review) throw new NotFoundError('Review de activación migratoria');
    await tx.billingAuditLog.create({
      data: {
        action: 'BILLING_MIGRATION_ACTIVATION_REVIEW_VIEWED', actorType: 'USER',
        actorUserId: actor.userId, actorUserIdSnapshot: actor.userId,
        targetType: 'BILLING_MIGRATION_ACTIVATION_REVIEW', targetId: review.id,
        requestId: actor.requestId, metadataRedacted: { status: review.status, itemCount: review.cohortCount },
      },
    });
    return reviewDto(review);
  });
}

export async function approveBillingMigrationActivationReview(input: {
  reviewId: string;
  approval: BillingMigrationActivationReviewApprovalInput;
  idempotencyKey: string;
  actor: AdminActor;
}) {
  const fingerprint = requestFingerprint({
    reviewId: input.reviewId, expectedVersion: input.approval.expectedVersion, reason: input.approval.reason,
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await configureRawQuerySchema(tx);
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `billing-migration-review:${input.reviewId}`);
        const existingAudit = await tx.billingAuditLog.findFirst({
          where: {
            actorUserIdSnapshot: input.actor.userId,
            action: 'BILLING_MIGRATION_ACTIVATION_REVIEW_APPROVED',
            targetType: 'BILLING_MIGRATION_ACTIVATION_REVIEW', targetId: input.reviewId,
            idempotencyKey: input.idempotencyKey,
          },
          select: { requestFingerprint: true },
        });
        const review = await tx.billingMigrationActivationReview.findUnique({
          where: { id: input.reviewId }, include: REVIEW_INCLUDE,
        });
        if (!review) throw new NotFoundError('Review de activación migratoria');
        if (existingAudit) {
          if (existingAudit.requestFingerprint !== fingerprint) {
            throw new ConflictError('Idempotency-Key ya fue utilizada con otra solicitud');
          }
          return reviewDto(review);
        }
        const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
        if (review.status !== 'PENDING_REVIEW') throw new ConflictError('El review no está pendiente de aprobación');
        if (review.expiresAt <= now) throw new AppError(409, 'El review expiró', 'BILLING_MIGRATION_REVIEW_EXPIRED');
        if (review.requestedByAdminIdSnapshot === input.actor.userId) {
          throw new AppError(403, 'La aprobación requiere un administrador distinto', 'BILLING_MIGRATION_SECOND_APPROVER_REQUIRED');
        }
        if (review.version !== input.approval.expectedVersion) throw new ConflictError('El review cambió durante la aprobación');
        if (review.items.some((item) => item.eligibilityStatus !== 'ELIGIBLE')) {
          throw new ConflictError('El review contiene cuentas bloqueadas');
        }
        const control = await tx.billingOperationalControl.findUnique({
          where: { environment: review.environment }, select: { mode: true, version: true },
        });
        if (control?.mode !== 'ENABLED' || control.version !== review.operationalControlVersion) {
          throw new AppError(409, 'El control operacional cambió desde la revisión', 'BILLING_MIGRATION_REVIEW_STALE');
        }
        const updated = await tx.billingMigrationActivationReview.update({
          where: { id: review.id },
          data: {
            status: 'APPROVED', approvedAt: now, approvedByAdminIdSnapshot: input.actor.userId,
            version: { increment: 1 },
          },
          include: REVIEW_INCLUDE,
        });
        await tx.billingAuditLog.create({
          data: {
            action: 'BILLING_MIGRATION_ACTIVATION_REVIEW_APPROVED', actorType: 'USER',
            actorUserId: input.actor.userId, actorUserIdSnapshot: input.actor.userId,
            targetType: 'BILLING_MIGRATION_ACTIVATION_REVIEW', targetId: review.id,
            requestId: input.actor.requestId, reason: input.approval.reason,
            idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint,
            metadataRedacted: { cohortSize: review.cohortCount, resultingVersion: review.version + 1 },
          },
        });
        return reviewDto(updated);
      }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 30_000 });
    } catch (error) {
      if ((error as { code?: unknown })?.code === 'P2034' && attempt < 2) continue;
      if ((error as { code?: unknown })?.code === 'P2034') throw new ConflictError('El review cambió durante la aprobación');
      throw error;
    }
  }
  throw new ConflictError('El review cambió durante la aprobación');
}

export async function acquireMigrationReviewLock(tx: Prisma.TransactionClient, reviewId: string): Promise<void> {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `billing-migration-review:${reviewId}`);
}

export const migrationActivationReviewInternals = { hash, requestFingerprint, reviewDto, REVIEW_HOURS, purchasesReady };
