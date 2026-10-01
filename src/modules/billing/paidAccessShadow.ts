import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { effectiveCapacityAt } from './effectiveCapacity';

export type PaidAccessShadowResult =
  | { state: 'NONE'; reason: 'DETACHED_ACCOUNT' | 'NO_CURRENT_PERIOD' }
  | { state: 'BLOCKED'; reason: string }
  | {
    state: 'PAID' | 'LOCAL_GRACE';
    capacity: number;
    graceEndsAt?: Date;
    assignments: Array<{
      slotNumber: number;
      divisionId: string | null;
      divisionIdSnapshot: string;
      assignedAt: Date;
    }>;
  };

export async function resolvePaidAccessShadowInTransaction(
  billingAccountId: string,
  tx: Prisma.TransactionClient,
): Promise<PaidAccessShadowResult> {
  const account = await tx.billingAccount.findUnique({
    where: { id: billingAccountId },
    select: { userId: true },
  });
  if (!account?.userId) return { state: 'NONE', reason: 'DETACHED_ACCOUNT' };

    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
    const periods = await tx.billingPeriod.findMany({
      where: {
        billingAccountId,
        effectiveStart: { lte: now },
        effectiveEnd: { gt: now },
        OR: [{ endedEarlyAt: null }, { endedEarlyAt: { gt: now } }],
      },
      orderBy: [{ effectiveStart: 'desc' }, { id: 'desc' }],
      take: 2,
      select: {
        source: true,
        capacityAtStart: true,
        enforcedAt: true,
        primaryProviderPeriodId: true,
        providerSources: { select: { billingProviderPeriodId: true, isPrimary: true } },
        capacityGrants: {
          select: { id: true, effectiveAt: true, sequence: true, newCapacity: true },
        },
        assignments: {
          where: { assignedAt: { lte: now } },
          orderBy: [{ slotNumber: 'asc' }, { id: 'asc' }],
          select: {
            slotNumber: true,
            divisionId: true,
            divisionIdSnapshot: true,
            ownerUserIdSnapshot: true,
            assignedAt: true,
          },
        },
      },
    });
    if (periods.length === 0) {
      const graces = await tx.billingLocalGrace.findMany({
        where: { billingAccountId, status: 'ACTIVE', startedAt: { lte: now }, endsAt: { gt: now } },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: 2,
        select: {
          startedAt: true,
          endsAt: true,
          sourceBillingPeriod: {
            select: {
              billingAccountId: true,
              source: true,
              capacityAtStart: true,
              enforcedAt: true,
              capacityGrants: {
                where: { effectiveAt: { lte: now } },
                select: { id: true, effectiveAt: true, sequence: true, newCapacity: true },
              },
              assignments: {
                where: { assignedAt: { lte: now } },
                orderBy: [{ slotNumber: 'asc' }, { id: 'asc' }],
                select: {
                  slotNumber: true,
                  divisionId: true,
                  divisionIdSnapshot: true,
                  ownerUserIdSnapshot: true,
                  assignedAt: true,
                },
              },
            },
          },
        },
      });
      if (graces.length === 0) return { state: 'NONE', reason: 'NO_CURRENT_PERIOD' };
      if (graces.length !== 1) return { state: 'BLOCKED', reason: 'multiple_active_graces' };
      const grace = graces[0];
      const source = grace.sourceBillingPeriod;
      if (source.billingAccountId !== billingAccountId || source.source !== 'STORE' || !source.enforcedAt) {
        return { state: 'BLOCKED', reason: 'invalid_grace_source' };
      }
      const grantsAtStart = source.capacityGrants.filter(({ effectiveAt }) => effectiveAt <= grace.startedAt);
      const assignmentsAtStart = source.assignments.filter(({ assignedAt }) => assignedAt <= grace.startedAt);
      const capacity = effectiveCapacityAt(source.capacityAtStart, grantsAtStart, grace.startedAt);
      if (!Number.isInteger(capacity) || capacity < 1) return { state: 'BLOCKED', reason: 'invalid_grace_capacity' };
      const slots = new Set<number>();
      const divisions = new Set<string>();
      for (const assignment of assignmentsAtStart) {
        if (assignment.slotNumber < 1 || assignment.slotNumber > capacity || slots.has(assignment.slotNumber)) {
          return { state: 'BLOCKED', reason: 'grace_assignment_out_of_capacity' };
        }
        if (divisions.has(assignment.divisionIdSnapshot) || assignment.ownerUserIdSnapshot !== account.userId) {
          return { state: 'BLOCKED', reason: 'invalid_grace_assignment' };
        }
        slots.add(assignment.slotNumber);
        divisions.add(assignment.divisionIdSnapshot);
      }
      return {
        state: 'LOCAL_GRACE',
        capacity,
        graceEndsAt: grace.endsAt,
        assignments: assignmentsAtStart.map(({ ownerUserIdSnapshot: _, ...assignment }) => assignment),
      };
    }
    if (periods.length !== 1) return { state: 'BLOCKED', reason: 'multiple_current_periods' };

    const period = periods[0];
    if (period.source !== 'STORE') return { state: 'BLOCKED', reason: 'unsupported_period_source' };
    if (!period.enforcedAt || period.enforcedAt > now) return { state: 'BLOCKED', reason: 'unenforced_period' };
    const primarySources = period.providerSources.filter(({ isPrimary }) => isPrimary);
    if (primarySources.length !== 1
      || primarySources[0].billingProviderPeriodId !== period.primaryProviderPeriodId) {
      return { state: 'BLOCKED', reason: 'invalid_primary_source' };
    }

    const capacity = effectiveCapacityAt(period.capacityAtStart, period.capacityGrants, now);
    if (!Number.isInteger(capacity) || capacity < 1) return { state: 'BLOCKED', reason: 'invalid_capacity' };
    const slots = new Set<number>();
    const divisions = new Set<string>();
    for (const assignment of period.assignments) {
      if (assignment.slotNumber < 1 || assignment.slotNumber > capacity || slots.has(assignment.slotNumber)) {
        return { state: 'BLOCKED', reason: 'assignment_out_of_capacity' };
      }
      if (divisions.has(assignment.divisionIdSnapshot)) {
        return { state: 'BLOCKED', reason: 'duplicate_assignment' };
      }
      if (assignment.ownerUserIdSnapshot !== account.userId) {
        return { state: 'BLOCKED', reason: 'assignment_owner_mismatch' };
      }
      slots.add(assignment.slotNumber);
      divisions.add(assignment.divisionIdSnapshot);
    }

    return {
      state: 'PAID',
      capacity,
      assignments: period.assignments.map(({ ownerUserIdSnapshot: _, ...assignment }) => assignment),
    };
}

export async function resolvePaidAccessShadow(
  billingAccountId: string,
  client: PrismaClient = prisma,
): Promise<PaidAccessShadowResult> {
  return client.$transaction(async (tx) => resolvePaidAccessShadowInTransaction(billingAccountId, tx), {
    isolationLevel: 'RepeatableRead', maxWait: 5_000, timeout: 15_000,
  });
}

export async function observePaidAccessShadow(
  billingAccountId: string,
  client: PrismaClient = prisma,
): Promise<void> {
  try {
    const result = await resolvePaidAccessShadow(billingAccountId, client);
    if (result.state === 'BLOCKED') {
      logger.warn({ event: 'billing.paid_access_shadow_blocked', reason: result.reason }, 'Paid access shadow blocked');
      return;
    }
    if (result.state === 'NONE') {
      logger.info({ event: 'billing.paid_access_shadow_resolved', state: result.state, reason: result.reason }, 'Paid access shadow resolved');
      return;
    }
    const tombstoneCount = result.assignments.filter(({ divisionId }) => divisionId === null).length;
    logger.info({
      event: 'billing.paid_access_shadow_discrepancy',
      shadowState: result.state,
      publicState: 'FREE',
      capacity: result.capacity,
      assignedCount: result.assignments.length,
      availableCount: result.capacity - result.assignments.length,
      tombstoneCount,
    }, 'Paid access shadow differs from public access as expected');
  } catch (cause) {
    logger.warn({
      event: 'billing.paid_access_shadow_blocked',
      reason: 'query_failed',
      causeType: cause instanceof Error ? cause.name : typeof cause,
      causeCode: typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : undefined,
    }, 'Paid access shadow query failed');
  }
}
