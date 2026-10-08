import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { prisma } from '../../config/database';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { AppError, NotFoundError, ValidationError } from '../../utils/errors';
import type { AccountAccessPolicy, BillingStateDto } from './types';
import { billingEnvironmentForApp, getActiveBillingCatalog } from './catalog';
import { resolvePaidAccessShadowInTransaction } from './paidAccessShadow';
import { resolveSubscriptionManagement } from './storeManagement';
import { resolveBillingChangeOperationState } from './changeOperationState';

type BillingClient = Pick<Prisma.TransactionClient, 'user' | 'billingAccount'>;

export async function acquireBillingOwnerBootstrapLock(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `billing-owner:${userId}`);
}

export async function acquireBillingAccountLock(
  tx: Prisma.TransactionClient,
  billingAccountId: string,
): Promise<void> {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `billing-account:${billingAccountId}`);
}

export async function ensureBillingAccount(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<{ id: string }> {
  await acquireBillingOwnerBootstrapLock(tx, userId);

  const existing = await tx.billingAccount.findUnique({ where: { userId }, select: { id: true } });
  if (existing) {
    await acquireBillingAccountLock(tx, existing.id);
    return existing;
  }

  const user = await tx.user.findUnique({ where: { id: userId }, select: { rol: true } });
  if (!user) throw new NotFoundError('Usuario');
  if (user.rol !== 'LIGA') throw new ValidationError('Solo una cuenta con rol LIGA puede tener una cuenta de billing');

  const id = `billing_${randomUUID()}`;
  const account = await tx.billingAccount.create({
    data: {
      id,
      userId,
      ownerUserIdSnapshot: userId,
      providerIdentities: {
        create: {
          revenueCatAppUserId: id,
          kind: 'CANONICAL',
          observedAsOriginal: true,
        },
      },
    },
    select: { id: true },
  });
  await acquireBillingAccountLock(tx, account.id);
  return account;
}

export async function ensureInitialFreeManagementGrant(
  tx: Prisma.TransactionClient,
  userId: string,
  divisionId: string,
): Promise<void> {
  // Division creation already holds the account quota lock. Only bootstrap when that lock used
  // the owner namespace because no billing account existed yet.
  const existingAccount = await tx.billingAccount.findUnique({ where: { userId }, select: { id: true } });
  const account = existingAccount ?? await ensureBillingAccount(tx, userId);
  const existing = await tx.freeManagementGrant.findFirst({
    where: { billingAccountId: account.id },
    select: { id: true },
  });
  if (existing) return;
  const paidHistory = await tx.billingPeriod.findFirst({
    where: { billingAccountId: account.id, source: 'STORE' },
    select: { id: true },
  });
  if (paidHistory) return;

  const division = await tx.division.findFirst({
    where: { id: divisionId, liga: { userId } },
    select: { id: true, nombre: true, liga: { select: { id: true, nombre: true } } },
  });
  if (!division) throw new NotFoundError('División');

  const divisionCount = await tx.division.count({ where: { liga: { userId } } });
  if (divisionCount !== 1) return;

  await tx.freeManagementGrant.create({
    data: {
      userId,
      billingAccountId: account.id,
      divisionId: division.id,
      divisionIdSnapshot: division.id,
      divisionNameSnapshot: division.nombre,
      leagueId: division.liga.id,
      leagueIdSnapshot: division.liga.id,
      leagueNameSnapshot: division.liga.nombre,
      source: 'INITIAL_FREE',
    },
  });
}

export async function detachBillingAccount(
  tx: Prisma.TransactionClient,
  userId: string,
  reason = 'ACCOUNT_DELETED',
): Promise<void> {
  const account = await tx.billingAccount.findUnique({ where: { userId }, select: { id: true } });
  if (!account) return;

  await acquireBillingAccountLock(tx, account.id);
  const now = new Date();
  await tx.freeManagementGrant.updateMany({
    where: { billingAccountId: account.id, endedAt: null },
    data: { endedAt: now, endReason: 'ACCOUNT_DELETED' },
  });
  await tx.billingProviderIdentity.updateMany({
    where: { billingAccountId: account.id, status: 'ACTIVE' },
    data: { status: 'RETIRED', retiredAt: now },
  });
  await tx.billingAccount.update({
    where: { id: account.id },
    data: { userId: null, detachedAt: now, detachReason: reason },
  });
}

export async function closeFreeManagementGrantForDeletedResource(
  tx: Prisma.TransactionClient,
  userId: string,
  resource: { divisionId: string } | { leagueId: string },
): Promise<void> {
  const account = await tx.billingAccount.findUnique({ where: { userId }, select: { id: true } });
  if (!account) return;

  // The caller holds acquireAccountQuotaLock, which resolves to this account namespace.
  await tx.freeManagementGrant.updateMany({
    where: { billingAccountId: account.id, endedAt: null, ...resource },
    data: { endedAt: new Date(), endReason: 'DIVISION_DELETED' },
  });
}

export async function assertMigrationAllowsResourceCreation(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const account = await tx.billingAccount.findUnique({
    where: { userId },
    select: { migrationAccess: { select: { status: true } } },
  });
  if (account?.migrationAccess
    && ['SELECTION_REQUIRED', 'SELECTED', 'PURCHASED'].includes(account.migrationAccess.status)) {
    throw new AppError(
      403,
      'No se pueden crear ligas o divisiones durante la transición de billing',
      'BILLING_MIGRATION_CREATION_BLOCKED',
    );
  }
}

export async function resolveAccountAccessPolicy(
  userId: string,
  client: BillingClient = prisma,
): Promise<AccountAccessPolicy> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { rol: true } });
  if (!user) throw new NotFoundError('Usuario');

  if (user.rol === 'ADMINISTRADOR') {
    return {
      role: user.rol,
      accessKind: 'ADMIN',
      effectiveAccess: 'ADMIN',
      billingAccountId: null,
      effectiveCapacity: 0,
      ownedTeamLimit: null,
      ownedLeagueLimit: null,
      ownedDivisionLimit: null,
      activeDivisionLimit: null,
      canConsumePaidSlot: false,
      freeDivisionId: null,
      freeManagementGrant: null,
    };
  }

  if (user.rol === 'CAPITAN') {
    return {
      role: user.rol,
      accessKind: 'CAPITAN',
      effectiveAccess: 'FREE',
      billingAccountId: null,
      effectiveCapacity: 0,
      ownedTeamLimit: 10,
      ownedLeagueLimit: 0,
      ownedDivisionLimit: 0,
      activeDivisionLimit: 0,
      canConsumePaidSlot: false,
      freeDivisionId: null,
      freeManagementGrant: null,
    };
  }

  const account = await client.billingAccount.findUnique({
    where: { userId },
    select: {
      id: true,
      freeGrants: {
        where: { endedAt: null },
        take: 2,
        select: {
          divisionIdSnapshot: true,
          divisionNameSnapshot: true,
          leagueIdSnapshot: true,
          leagueNameSnapshot: true,
          grantedAt: true,
        },
      },
      migrationAccess: {
        select: {
          status: true, deadline: true, preparedDivisionCount: true, selectedFreeDivisionIdSnapshot: true,
          divisions: {
            select: {
              divisionIdSnapshot: true,
              division: { select: { nombre: true, liga: { select: { nombre: true } } } },
            },
          },
        },
      },
    },
  });

  if (account && env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED) {
    if (account.freeGrants.length > 1) {
      throw new AppError(409, 'La cuenta tiene grants gratuitos activos contradictorios', 'BILLING_EVIDENCE_INVALID');
    }
    const paid = await resolvePaidAccessShadowInTransaction(
      account.id,
      client as unknown as Prisma.TransactionClient,
    );
    if (paid.state === 'BLOCKED') {
      throw new AppError(409, 'La evidencia de billing no permite resolver el acceso', 'BILLING_EVIDENCE_INVALID');
    }
    let activeMigration: {
      deadline: Date;
      paused: boolean;
      divisions: Array<{ id: string; name: string; leagueName: string }>;
      selectedDivisionId: string | null;
    } | null = null;
    const migrationStatus = account.migrationAccess?.status;
    if (migrationStatus && ['SELECTION_REQUIRED', 'SELECTED', 'PURCHASED'].includes(migrationStatus)
      && account.migrationAccess?.deadline) {
      const [{ now }] = await (client as unknown as Prisma.TransactionClient)
        .$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
      const pause = await (client as unknown as Prisma.TransactionClient).billingOperationalPause.findFirst({
        where: { environment: billingEnvironmentForApp(), endedAt: null }, select: { startedAt: true },
      });
      const pausedBeforeDeadline = Boolean(pause && pause.startedAt < account.migrationAccess.deadline);
      if (account.migrationAccess.deadline > now || pausedBeforeDeadline) {
        if (account.freeGrants.length > 0) {
          throw new AppError(409, 'La transición contradice un grant gratuito activo', 'BILLING_EVIDENCE_INVALID');
        }
        activeMigration = {
          deadline: account.migrationAccess.deadline, paused: pausedBeforeDeadline,
          selectedDivisionId: account.migrationAccess.selectedFreeDivisionIdSnapshot,
          divisions: account.migrationAccess.divisions.flatMap((snapshot) => snapshot.division
            ? [{ id: snapshot.divisionIdSnapshot, name: snapshot.division.nombre, leagueName: snapshot.division.liga.nombre }]
            : []),
        };
      }
    }
    if (paid.state === 'PAID' || paid.state === 'LOCAL_GRACE') {
      if (account.freeGrants.length > 0) {
        throw new AppError(409, 'El acceso pagado contradice un grant gratuito activo', 'BILLING_EVIDENCE_INVALID');
      }
      return {
        role: user.rol,
        accessKind: 'PAID',
        effectiveAccess: paid.state,
        billingAccountId: account.id,
        effectiveCapacity: paid.capacity,
        ownedTeamLimit: 40,
        ownedLeagueLimit: paid.capacity,
        ownedDivisionLimit: paid.capacity,
        activeDivisionLimit: paid.capacity,
        canConsumePaidSlot: paid.state === 'PAID' && paid.assignments.length < paid.capacity,
        freeDivisionId: null,
        freeManagementGrant: null,
        migrationOverlayActive: Boolean(activeMigration),
        migrationDeadline: activeMigration?.deadline,
        migrationPaused: activeMigration?.paused,
        migrationSelectedDivisionId: activeMigration?.selectedDivisionId,
        migrationDivisions: activeMigration?.divisions,
      };
    }
    if (activeMigration) {
      return {
        role: user.rol, accessKind: 'PAID', effectiveAccess: 'MIGRATION',
        billingAccountId: account.id, effectiveCapacity: account.migrationAccess!.preparedDivisionCount,
        ownedTeamLimit: 40, ownedLeagueLimit: account.migrationAccess!.preparedDivisionCount,
        ownedDivisionLimit: account.migrationAccess!.preparedDivisionCount,
        activeDivisionLimit: account.migrationAccess!.preparedDivisionCount,
        canConsumePaidSlot: false, freeDivisionId: null, freeManagementGrant: null,
        migrationOverlayActive: true, migrationDeadline: activeMigration.deadline,
        migrationPaused: activeMigration.paused,
        migrationSelectedDivisionId: activeMigration.selectedDivisionId,
        migrationDivisions: activeMigration.divisions,
      };
    }
  }

  const grant = account?.freeGrants[0];
  return {
    role: user.rol,
    accessKind: 'FREE_LIGA',
    effectiveAccess: 'FREE',
    billingAccountId: account?.id ?? null,
    effectiveCapacity: 1,
    ownedTeamLimit: 40,
    ownedLeagueLimit: 1,
    ownedDivisionLimit: 1,
    activeDivisionLimit: 1,
    canConsumePaidSlot: false,
    freeDivisionId: grant?.divisionIdSnapshot ?? null,
    freeManagementGrant: grant ? {
      divisionId: grant.divisionIdSnapshot,
      divisionName: grant.divisionNameSnapshot,
      leagueId: grant.leagueIdSnapshot,
      leagueName: grant.leagueNameSnapshot,
      grantedAt: grant.grantedAt,
    } : null,
  };
}

export async function getBillingState(userId: string, client: BillingClient = prisma): Promise<BillingStateDto> {
  const policy = await resolveAccountAccessPolicy(userId, client);
  let purchasesEnabled = false;
  if ('billingCatalogRelease' in client && 'billingOperationalControl' in client) {
    try {
      purchasesEnabled = (await getActiveBillingCatalog(
        billingEnvironmentForApp(),
        client as PrismaClient,
      )).purchasesEnabled;
    } catch {
      purchasesEnabled = false;
    }
  }
  const subscriptionManagement = await resolveSubscriptionManagement(policy.billingAccountId, client);
  const changeOperationState = await resolveBillingChangeOperationState(policy.billingAccountId, client);
  return {
    role: policy.role,
    effectiveAccess: policy.effectiveAccess,
    billingAccountId: policy.billingAccountId,
    revenueCatAppUserId: policy.billingAccountId,
    effectiveCapacity: policy.effectiveCapacity,
    limits: {
      teams: policy.ownedTeamLimit,
      leagues: policy.ownedLeagueLimit,
      divisions: policy.ownedDivisionLimit,
    },
    freeManagementGrant: policy.freeManagementGrant,
    purchasesEnabled,
    subscriptionManagement,
    nextAction: changeOperationState.nextAction,
    activeChangeOperation: changeOperationState.activeChangeOperation,
    migrationOverlayActive: policy.migrationOverlayActive,
    migrationDeadline: policy.migrationDeadline,
    migrationPaused: policy.migrationPaused,
    migrationSelectedDivisionId: policy.migrationSelectedDivisionId,
    migrationDivisions: policy.migrationDivisions,
  };
}

export async function bootstrapBillingAccount(
  userId: string,
  client: PrismaClient = prisma,
): Promise<BillingStateDto> {
  await client.$transaction((tx) => ensureBillingAccount(tx, userId));
  return getBillingState(userId, client);
}
