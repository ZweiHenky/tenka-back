import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import type { Prisma } from '../../generated/prisma/client';
import { AppError } from '../../utils/errors';
import { billingEvidenceHash } from './providerEvidence';

export function localGraceIncidentKey(input: {
  billingAccountId: string;
  sourceBillingPeriodId: string;
  providerSubscriptionId: string;
  graceStartedAt: Date;
}) {
  return billingEvidenceHash('billing-local-grace-v1', {
    billingAccountId: input.billingAccountId,
    sourceBillingPeriodId: input.sourceBillingPeriodId,
    providerSubscriptionId: input.providerSubscriptionId,
    graceStartedAt: input.graceStartedAt.toISOString(),
    reason: 'BILLING_FAILURE',
  });
}

async function audit(
  tx: Prisma.TransactionClient,
  action: 'BILLING_LOCAL_GRACE_STARTED' | 'BILLING_LOCAL_GRACE_RECOVERED'
    | 'BILLING_LOCAL_GRACE_EXPIRED' | 'BILLING_LOCAL_GRACE_TERMINATED',
  graceId: string,
  metadataRedacted: Prisma.InputJsonObject,
) {
  await tx.billingAuditLog.create({
    data: {
      action,
      actorType: 'SYSTEM',
      actorUserIdSnapshot: 'billing-local-grace',
      targetType: 'BillingLocalGrace',
      targetId: graceId,
      requestId: randomUUID(),
      metadataRedacted,
    },
  });
}

export async function createPaidExpirationFreeGrantInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    billingAccountId: string;
    sourceBillingPeriodId: string;
    eligibleAt: Date;
    grantedAt: Date;
    sourceLocalGraceId?: string;
  },
): Promise<boolean> {
  const existingGrant = await tx.freeManagementGrant.findFirst({
    where: { billingAccountId: input.billingAccountId, endedAt: null },
    select: { id: true },
  });
  if (existingGrant) return false;

  const account = await tx.billingAccount.findUnique({
    where: { id: input.billingAccountId },
    select: { userId: true },
  });
  if (!account?.userId) return false;

  const assignments = await tx.divisionCapacityAssignment.findMany({
    where: {
      billingPeriodId: input.sourceBillingPeriodId,
      divisionId: { not: null },
      assignedAt: { lte: input.eligibleAt },
    },
    orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }],
    select: {
      divisionId: true,
      divisionIdSnapshot: true,
      divisionNameSnapshot: true,
      leagueIdSnapshot: true,
      leagueNameSnapshot: true,
    },
  });
  for (const assignment of assignments) {
    if (!assignment.divisionId) continue;
    const division = await tx.division.findFirst({
      where: { id: assignment.divisionId, liga: { userId: account.userId } },
      select: { id: true, ligaId: true },
    });
    if (!division) continue;
    await tx.freeManagementGrant.create({
      data: {
        userId: account.userId,
        billingAccountId: input.billingAccountId,
        divisionId: division.id,
        divisionIdSnapshot: assignment.divisionIdSnapshot,
        divisionNameSnapshot: assignment.divisionNameSnapshot,
        leagueId: division.ligaId,
        leagueIdSnapshot: assignment.leagueIdSnapshot,
        leagueNameSnapshot: assignment.leagueNameSnapshot,
        source: 'PAID_EXPIRATION',
        grantedAt: input.grantedAt,
        sourceLocalGraceId: input.sourceLocalGraceId,
      },
    });
    return true;
  }
  return false;
}

export async function startLocalGraceInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    billingAccountId: string;
    sourceBillingPeriodId: string;
    providerSubscriptionId: string;
    graceStartedAt: Date;
    now: Date;
  },
) {
  const incidentKey = localGraceIncidentKey(input);
  const existing = await tx.billingLocalGrace.findUnique({
    where: { billingAccountId_incidentKey: { billingAccountId: input.billingAccountId, incidentKey } },
  });
  if (existing) return { grace: existing, created: false };

  const activeFreeGrant = await tx.freeManagementGrant.findFirst({
    where: { billingAccountId: input.billingAccountId, endedAt: null },
    select: { id: true },
  });
  if (activeFreeGrant) {
    throw new AppError(409, 'La gracia local contradice un grant gratuito activo', 'BILLING_LOCAL_GRACE_CONFLICT');
  }
  const activeGrace = await tx.billingLocalGrace.findFirst({
    where: { billingAccountId: input.billingAccountId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (activeGrace) {
    throw new AppError(409, 'Ya existe una gracia local activa para la cuenta', 'BILLING_LOCAL_GRACE_CONFLICT');
  }

  const endsAt = new Date(input.graceStartedAt.getTime() + env.BILLING_GRACE_DAYS * 86_400_000);
  const grace = await tx.billingLocalGrace.create({
    data: {
      billingAccountId: input.billingAccountId,
      incidentKey,
      reason: 'BILLING_FAILURE',
      sourceBillingPeriodId: input.sourceBillingPeriodId,
      startedAt: input.graceStartedAt,
      endsAt,
    },
  });
  await audit(tx, 'BILLING_LOCAL_GRACE_STARTED', grace.id, {
    graceDays: env.BILLING_GRACE_DAYS,
    observedAfterDeadline: input.now >= endsAt,
  });
  return { grace, created: true };
}

export async function recoverLocalGraceInTransaction(
  tx: Prisma.TransactionClient,
  input: { graceId: string; recoveryBillingPeriodId: string; recoveredAt: Date },
) {
  const updated = await tx.billingLocalGrace.updateMany({
    where: { id: input.graceId, status: 'ACTIVE', endsAt: { gt: input.recoveredAt } },
    data: {
      status: 'RECOVERED',
      recoveryBillingPeriodId: input.recoveryBillingPeriodId,
      recoveredAt: input.recoveredAt,
    },
  });
  if (updated.count !== 1) {
    throw new AppError(409, 'La gracia local cambió durante la recuperación', 'BILLING_LOCAL_GRACE_CONFLICT');
  }
  await audit(tx, 'BILLING_LOCAL_GRACE_RECOVERED', input.graceId, { recovered: true });
}

export async function expireLocalGraceInTransaction(
  tx: Prisma.TransactionClient,
  input: { graceId: string; now: Date; createFreeGrant: boolean },
): Promise<boolean> {
  const grace = await tx.billingLocalGrace.findUnique({
    where: { id: input.graceId },
    select: {
      id: true,
      status: true,
      startedAt: true,
      endsAt: true,
      billingAccountId: true,
      sourceBillingPeriodId: true,
    },
  });
  if (!grace || grace.status !== 'ACTIVE' || grace.endsAt > input.now) return false;

  const expired = await tx.billingLocalGrace.updateMany({
    where: { id: grace.id, status: 'ACTIVE', endsAt: { lte: input.now } },
    data: { status: 'EXPIRED', expiredAt: input.now },
  });
  if (expired.count !== 1) return false;

  const freeGrantCreated = input.createFreeGrant
    ? await createPaidExpirationFreeGrantInTransaction(tx, {
      billingAccountId: grace.billingAccountId,
      sourceBillingPeriodId: grace.sourceBillingPeriodId,
      eligibleAt: grace.startedAt,
      grantedAt: input.now,
      sourceLocalGraceId: grace.id,
    })
    : false;
  await audit(tx, 'BILLING_LOCAL_GRACE_EXPIRED', grace.id, { freeGrantCreated });
  return true;
}

export async function terminateLocalGraceInTransaction(
  tx: Prisma.TransactionClient,
  input: { graceId: string; now: Date; reason: string },
) {
  const grace = await tx.billingLocalGrace.findUnique({
    where: { id: input.graceId },
    select: {
      id: true,
      status: true,
      startedAt: true,
      billingAccountId: true,
      sourceBillingPeriodId: true,
    },
  });
  if (!grace || grace.status !== 'ACTIVE') return false;
  const updated = await tx.billingLocalGrace.updateMany({
    where: { id: input.graceId, status: 'ACTIVE' },
    data: { status: 'TERMINATED', terminatedAt: input.now },
  });
  if (updated.count === 0) return false;
  const freeGrantCreated = await createPaidExpirationFreeGrantInTransaction(tx, {
    billingAccountId: grace.billingAccountId,
    sourceBillingPeriodId: grace.sourceBillingPeriodId,
    eligibleAt: grace.startedAt,
    grantedAt: input.now,
    sourceLocalGraceId: grace.id,
  });
  await audit(tx, 'BILLING_LOCAL_GRACE_TERMINATED', input.graceId, {
    reason: input.reason,
    freeGrantCreated,
  });
  return true;
}
