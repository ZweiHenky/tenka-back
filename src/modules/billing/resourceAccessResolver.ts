import type { Prisma } from '../../generated/prisma/client';
import type { UserRole } from '../../types/auth';
import { resolvePaidAccessShadowInTransaction, type PaidAccessShadowResult } from './paidAccessShadow';
import { acquireBillingAccountLock } from './service';
import { currentBillingEnvironment } from './migrationLifecycleService';

export type ManagementAccess = 'FULL' | 'LIMITED_SETUP' | 'READ_ONLY' | 'BLOCKED';
export type ManagementReason =
  | 'ADMIN'
  | 'PAID_ASSIGNED'
  | 'FREE'
  | 'LOCAL_GRACE'
  | 'MIGRATION'
  | 'UNASSIGNED'
  | 'EXPIRED'
  | 'CAPACITY_REQUIRED'
  | 'ROLE_REQUIRED'
  | 'SHARED_RESOURCE_LOCKED'
  | 'INVALID_BILLING_EVIDENCE';

export interface ResourceAccessDecision {
  access: ManagementAccess;
  reason: ManagementReason;
  basis: 'ADMIN' | 'FREE' | 'PAID' | 'LOCAL_GRACE' | 'MIGRATION';
  resourceType: 'DIVISION' | 'LEAGUE' | 'SHARED_RESOURCE';
  paidCapacity?: number;
  assignedCount?: number;
  migrationPrepared?: boolean;
  migrationResourceCaptured?: boolean;
  migrationCapturedCount?: number;
  migrationOverlayActive?: boolean;
  migrationDeadline?: Date;
  migrationPaused?: boolean;
}

export interface ResourceActor {
  id: string;
  rol: UserRole;
}

interface OwnerContext {
  ownerRole: UserRole | null;
  activeFreeDivisionId: string | null;
  paid: PaidAccessShadowResult;
  migrationPrepared: boolean;
  migrationDivisionIds: Set<string>;
  migrationOverlayActive: boolean;
  migrationDeadline: Date | null;
  migrationPaused: boolean;
}

function migrationMetadata(context: OwnerContext, divisionId?: string) {
  return {
    migrationPrepared: context.migrationPrepared,
    migrationResourceCaptured: divisionId ? context.migrationDivisionIds.has(divisionId) : undefined,
    migrationCapturedCount: context.migrationDivisionIds.size,
    migrationOverlayActive: context.migrationOverlayActive,
    migrationDeadline: context.migrationDeadline ?? undefined,
    migrationPaused: context.migrationPaused,
  };
}

async function ownerContext(
  tx: Prisma.TransactionClient,
  ownerUserId: string,
): Promise<OwnerContext> {
  const accountIdentity = await tx.billingAccount.findUnique({
    where: { userId: ownerUserId },
    select: { id: true },
  });
  if (!accountIdentity) {
    const owner = await tx.user.findUnique({ where: { id: ownerUserId }, select: { rol: true } });
    return {
      ownerRole: owner?.rol ?? null,
      activeFreeDivisionId: null,
      paid: { state: 'NONE', reason: 'NO_CURRENT_PERIOD' },
      migrationPrepared: false,
      migrationDivisionIds: new Set(),
      migrationOverlayActive: false,
      migrationDeadline: null,
      migrationPaused: false,
    };
  }
  await acquireBillingAccountLock(tx, accountIdentity.id);
  const owner = await tx.user.findUnique({ where: { id: ownerUserId }, select: { rol: true } });
  const account = await tx.billingAccount.findUnique({
    where: { id: accountIdentity.id },
    select: {
      id: true,
      userId: true,
      freeGrants: {
        where: { endedAt: null },
        take: 2,
        select: { divisionId: true },
      },
      migrationAccess: {
        select: {
           status: true,
           deadline: true,
           activatedAt: true,
          divisions: { select: { divisionId: true } },
        },
      },
    },
  });
  if (!account || account.userId !== ownerUserId) {
    return {
      ownerRole: owner?.rol ?? null,
      activeFreeDivisionId: null,
      paid: { state: 'BLOCKED', reason: 'detached_account_during_resolution' },
      migrationPrepared: false,
      migrationDivisionIds: new Set(),
      migrationOverlayActive: false,
      migrationDeadline: null,
      migrationPaused: false,
    };
  }
  const activeMigrationState = Boolean(account.migrationAccess
    && ['SELECTION_REQUIRED', 'SELECTED', 'PURCHASED'].includes(account.migrationAccess.status)
    && account.migrationAccess.deadline);
  const [{ now }] = activeMigrationState
    ? await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`
    : [{ now: new Date(0) }];
  const openPause = activeMigrationState ? await tx.billingOperationalPause.findFirst({
    where: { environment: currentBillingEnvironment(), endedAt: null }, select: { startedAt: true },
  }) : null;
  const migrationPaused = Boolean(openPause
    && account.migrationAccess?.deadline
    && account.migrationAccess.activatedAt
    && openPause.startedAt < account.migrationAccess.deadline
    && now >= account.migrationAccess.activatedAt);
  const migrationOverlayActive = Boolean(activeMigrationState
    && account.migrationAccess?.deadline
    && (account.migrationAccess.deadline > now || migrationPaused));
  if (account.freeGrants.length > 1) {
    return {
      ownerRole: owner?.rol ?? null,
      activeFreeDivisionId: null,
      paid: { state: 'BLOCKED', reason: 'multiple_active_free_grants' },
      migrationPrepared: account.migrationAccess?.status === 'PREPARED',
      migrationDivisionIds: new Set(account.migrationAccess?.divisions.flatMap(({ divisionId }) => divisionId ? [divisionId] : []) ?? []),
      migrationOverlayActive,
      migrationDeadline: account.migrationAccess?.deadline ?? null,
      migrationPaused,
    };
  }
  return {
    ownerRole: owner?.rol ?? null,
    activeFreeDivisionId: account.freeGrants[0]?.divisionId ?? null,
    paid: await resolvePaidAccessShadowInTransaction(account.id, tx),
    migrationPrepared: account.migrationAccess?.status === 'PREPARED',
    migrationDivisionIds: new Set(account.migrationAccess?.divisions.flatMap(({ divisionId }) => divisionId ? [divisionId] : []) ?? []),
    migrationOverlayActive,
    migrationDeadline: account.migrationAccess?.deadline ?? null,
    migrationPaused,
  };
}

function invalidOwnerContext(
  context: OwnerContext,
  resourceType: ResourceAccessDecision['resourceType'],
): ResourceAccessDecision | null {
  if (context.ownerRole !== 'LIGA') {
    return { access: 'BLOCKED', reason: 'ROLE_REQUIRED', basis: 'FREE', resourceType, ...migrationMetadata(context) };
  }
  if (context.paid.state === 'BLOCKED') {
    return { access: 'BLOCKED', reason: 'INVALID_BILLING_EVIDENCE', basis: 'PAID', resourceType, ...migrationMetadata(context) };
  }
  if ((context.paid.state === 'PAID' || context.paid.state === 'LOCAL_GRACE') && context.activeFreeDivisionId) {
    return { access: 'BLOCKED', reason: 'INVALID_BILLING_EVIDENCE', basis: context.paid.state === 'LOCAL_GRACE' ? 'LOCAL_GRACE' : 'PAID', resourceType, ...migrationMetadata(context) };
  }
  return null;
}

function classifyDivision(
  divisionId: string,
  context: OwnerContext,
): ResourceAccessDecision {
  const invalid = invalidOwnerContext(context, 'DIVISION');
  if (invalid) return { ...invalid, ...migrationMetadata(context, divisionId) };
  if (context.paid.state === 'PAID' || context.paid.state === 'LOCAL_GRACE') {
    const localGrace = context.paid.state === 'LOCAL_GRACE';
    const assigned = context.paid.assignments.some((assignment) => assignment.divisionId === divisionId);
    if (!assigned && context.migrationOverlayActive && context.migrationDivisionIds.has(divisionId)) {
      return {
        access: 'FULL', reason: 'MIGRATION', basis: 'MIGRATION', resourceType: 'DIVISION',
        paidCapacity: context.paid.capacity, assignedCount: context.paid.assignments.length,
        ...migrationMetadata(context, divisionId),
      };
    }
    return {
      access: assigned ? 'FULL' : 'READ_ONLY',
      reason: assigned ? (localGrace ? 'LOCAL_GRACE' : 'PAID_ASSIGNED') : 'UNASSIGNED',
      basis: localGrace ? 'LOCAL_GRACE' : 'PAID',
      resourceType: 'DIVISION',
      paidCapacity: context.paid.capacity,
      assignedCount: context.paid.assignments.length,
      ...migrationMetadata(context, divisionId),
    };
  }
  if (context.migrationOverlayActive && context.migrationDivisionIds.has(divisionId)) {
    return {
      access: 'FULL', reason: 'MIGRATION', basis: 'MIGRATION', resourceType: 'DIVISION',
      ...migrationMetadata(context, divisionId),
    };
  }
  return {
    access: context.activeFreeDivisionId === divisionId ? 'FULL' : 'READ_ONLY',
    reason: context.activeFreeDivisionId === divisionId ? 'FREE' : 'EXPIRED',
    basis: 'FREE',
    resourceType: 'DIVISION',
    ...migrationMetadata(context, divisionId),
  };
}

export async function resolveDivisionAccessShadowInTransaction(
  tx: Prisma.TransactionClient,
  input: { divisionId: string; actor?: ResourceActor },
): Promise<ResourceAccessDecision> {
  const division = await tx.division.findUnique({
    where: { id: input.divisionId },
    select: { id: true, liga: { select: { userId: true } } },
  });
  if (!division) {
    return { access: 'BLOCKED', reason: 'INVALID_BILLING_EVIDENCE', basis: 'FREE', resourceType: 'DIVISION' };
  }
  if (input.actor?.rol === 'ADMINISTRADOR') {
    return { access: 'FULL', reason: 'ADMIN', basis: 'ADMIN', resourceType: 'DIVISION' };
  }
  if (input.actor && input.actor.id !== division.liga.userId) {
    return { access: 'BLOCKED', reason: 'ROLE_REQUIRED', basis: 'FREE', resourceType: 'DIVISION' };
  }
  return classifyDivision(division.id, await ownerContext(tx, division.liga.userId));
}

export async function resolveLeagueAccessShadowInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    leagueId: string;
    actor?: ResourceActor;
    resourceType?: 'LEAGUE' | 'SHARED_RESOURCE';
    affectedDivisionIds?: string[];
  },
): Promise<ResourceAccessDecision> {
  const resourceType = input.resourceType ?? 'LEAGUE';
  const league = await tx.liga.findUnique({
    where: { id: input.leagueId },
    select: { userId: true, divisiones: { select: { id: true } } },
  });
  if (!league) {
    return { access: 'BLOCKED', reason: 'INVALID_BILLING_EVIDENCE', basis: 'FREE', resourceType };
  }
  if (input.actor?.rol === 'ADMINISTRADOR') {
    return { access: 'FULL', reason: 'ADMIN', basis: 'ADMIN', resourceType };
  }
  if (input.actor && input.actor.id !== league.userId) {
    return { access: 'BLOCKED', reason: 'ROLE_REQUIRED', basis: 'FREE', resourceType };
  }
  const context = await ownerContext(tx, league.userId);
  const invalid = invalidOwnerContext(context, resourceType);
  if (invalid) return invalid;

  const requestedIds = input.affectedDivisionIds ? new Set(input.affectedDivisionIds) : null;
  const leagueIds = new Set(league.divisiones.map(({ id }) => id));
  if (requestedIds && [...requestedIds].some((id) => !leagueIds.has(id))) {
    return {
      access: 'BLOCKED',
      reason: 'INVALID_BILLING_EVIDENCE',
      basis: context.paid.state === 'LOCAL_GRACE' ? 'LOCAL_GRACE' : context.paid.state === 'PAID' ? 'PAID' : 'FREE',
      resourceType,
      ...migrationMetadata(context),
    };
  }
  const affected = requestedIds
    ? league.divisiones.filter(({ id }) => requestedIds.has(id))
    : league.divisiones;
  if (affected.length === 0) {
    const paidCapacity = context.paid.state === 'PAID' || context.paid.state === 'LOCAL_GRACE' ? context.paid.capacity : undefined;
    const assignedCount = context.paid.state === 'PAID' || context.paid.state === 'LOCAL_GRACE' ? context.paid.assignments.length : undefined;
    const hasCapacity = context.paid.state === 'PAID'
      ? context.paid.assignments.length < context.paid.capacity
      : context.paid.state === 'LOCAL_GRACE' ? false : !context.activeFreeDivisionId;
    return {
      access: hasCapacity ? 'LIMITED_SETUP' : 'READ_ONLY',
      reason: hasCapacity ? 'CAPACITY_REQUIRED' : 'UNASSIGNED',
      basis: context.paid.state === 'LOCAL_GRACE' ? 'LOCAL_GRACE' : context.paid.state === 'PAID' ? 'PAID' : 'FREE',
      resourceType,
      paidCapacity,
      assignedCount,
      ...migrationMetadata(context),
    };
  }
  const decisions = affected.map(({ id }) => classifyDivision(id, context));
  const blocked = decisions.find(({ access }) => access === 'BLOCKED');
  if (blocked) return { ...blocked, resourceType };
  const full = decisions.filter(({ access }) => access === 'FULL');
  if (resourceType === 'SHARED_RESOURCE' && full.length !== decisions.length) {
    const paid = decisions.find(({ basis }) => basis === 'PAID' || basis === 'LOCAL_GRACE');
    return {
      access: 'READ_ONLY',
      reason: 'SHARED_RESOURCE_LOCKED',
      basis: paid?.basis ?? 'FREE',
      resourceType,
      paidCapacity: paid?.paidCapacity,
      assignedCount: paid?.assignedCount,
      ...migrationMetadata(context),
    };
  }
  if (full.length > 0) return { ...full[0], resourceType };
  const paid = decisions.find(({ basis }) => basis === 'PAID' || basis === 'LOCAL_GRACE');
  return {
    access: 'READ_ONLY',
    reason: 'UNASSIGNED',
    basis: paid?.basis ?? 'FREE',
    resourceType,
    paidCapacity: paid?.paidCapacity,
    assignedCount: paid?.assignedCount,
    ...migrationMetadata(context),
  };
}
