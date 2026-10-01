import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { assertDevelopmentScriptContext } from '../../utils/developmentDatabase';
import { configureRawQuerySchema } from '../../utils/rawDatabaseSchema';
import {
  acquireBillingAccountLock,
  acquireBillingOwnerBootstrapLock,
  ensureBillingAccount,
  ensureInitialFreeManagementGrant,
} from './service';

export interface FreeFoundationAuditResult {
  ligaUsers: number;
  attachedAccounts: number;
  missingAccounts: number;
  missingAccountZeroDivisions: number;
  missingAccountOneDivision: number;
  missingAccountMultipleDivisions: number;
  singleDivisionWithoutGrant: number;
  singleDivisionWithGrantHistory: number;
  singleDivisionWithStoreHistory: number;
  storeWithActiveFreeGrant: number;
  zeroDivisionWithActiveGrant: number;
  canonicalIdentityIssues: number;
  detachedOwnerConflicts: number;
  migrationStateConflicts: number;
}

export type FreeFoundationIssueCode =
  | 'USER_NOT_FOUND'
  | 'ROLE_REQUIRED'
  | 'DETACHED_ACCOUNT_CONFLICT'
  | 'MULTIPLE_DIVISIONS'
  | 'CANONICAL_IDENTITY_INVALID'
  | 'MIGRATION_STATE_CONFLICT'
  | 'FREE_GRANT_CONFLICT'
  | 'CONCURRENT_CHANGE';

export interface FreeFoundationReconciliationResult {
  scanned: number;
  accountsCreated: number;
  identitiesCreated: number;
  grantsCreated: number;
  unchanged: number;
  blocked: number;
  issues: Array<{ code: FreeFoundationIssueCode; count: number }>;
}

class FoundationBlockedError extends Error {
  constructor(readonly issueCode: FreeFoundationIssueCode) {
    super(issueCode);
  }
}

function increment(map: Map<string, number>, code: string): void {
  map.set(code, (map.get(code) ?? 0) + 1);
}

function issues<T extends string>(map: Map<string, number>): Array<{ code: T; count: number }> {
  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, count]) => ({ code: code as T, count }));
}

function canonicalIdentityValid(account: {
  id: string;
  providerIdentities: Array<{
    revenueCatAppUserId: string;
    kind: string;
    status: string;
    retiredAt: Date | null;
  }>;
}): boolean {
  const identities = account.providerIdentities.filter(({ kind }) => kind === 'CANONICAL');
  return identities.length === 1
    && identities[0].revenueCatAppUserId === account.id
    && identities[0].status === 'ACTIVE'
    && identities[0].retiredAt === null;
}

export async function auditFreeFoundation(
  client: PrismaClient,
): Promise<FreeFoundationAuditResult> {
  assertDevelopmentScriptContext();
  const users = await client.user.findMany({
    where: { rol: 'LIGA' },
    select: {
      id: true,
      ligas: { select: { divisiones: { select: { id: true } } } },
      billingAccount: {
        select: {
          id: true,
          providerIdentities: {
            select: { revenueCatAppUserId: true, kind: true, status: true, retiredAt: true },
          },
          freeGrants: { select: { divisionId: true, endedAt: true } },
          billingPeriods: { where: { source: 'STORE' }, take: 1, select: { id: true } },
          migrationAccess: { select: { id: true } },
        },
      },
    },
  });
  const detachedOwners = new Set((await client.billingAccount.findMany({
    where: { userId: null, ownerUserIdSnapshot: { in: users.map(({ id }) => id) } },
    select: { ownerUserIdSnapshot: true },
  })).map(({ ownerUserIdSnapshot }) => ownerUserIdSnapshot));
  const result: FreeFoundationAuditResult = {
    ligaUsers: users.length,
    attachedAccounts: 0,
    missingAccounts: 0,
    missingAccountZeroDivisions: 0,
    missingAccountOneDivision: 0,
    missingAccountMultipleDivisions: 0,
    singleDivisionWithoutGrant: 0,
    singleDivisionWithGrantHistory: 0,
    singleDivisionWithStoreHistory: 0,
    storeWithActiveFreeGrant: 0,
    zeroDivisionWithActiveGrant: 0,
    canonicalIdentityIssues: 0,
    detachedOwnerConflicts: 0,
    migrationStateConflicts: 0,
  };

  for (const user of users) {
    const divisionIds = user.ligas.flatMap((league) => league.divisiones.map(({ id }) => id));
    const account = user.billingAccount;
    if (!account) {
      result.missingAccounts += 1;
      if (divisionIds.length === 0) result.missingAccountZeroDivisions += 1;
      else if (divisionIds.length === 1) result.missingAccountOneDivision += 1;
      else result.missingAccountMultipleDivisions += 1;
      if (detachedOwners.has(user.id)) result.detachedOwnerConflicts += 1;
      continue;
    }
    result.attachedAccounts += 1;
    if (!canonicalIdentityValid(account)) result.canonicalIdentityIssues += 1;
    if (account.migrationAccess && divisionIds.length <= 1) result.migrationStateConflicts += 1;
    const activeGrants = account.freeGrants.filter(({ endedAt }) => endedAt === null);
    if (account.billingPeriods.length > 0 && activeGrants.length > 0) result.storeWithActiveFreeGrant += 1;
    if (divisionIds.length === 0 && activeGrants.length > 0) result.zeroDivisionWithActiveGrant += 1;
    if (divisionIds.length === 1 && activeGrants.length === 0) {
      if (account.billingPeriods.length > 0) result.singleDivisionWithStoreHistory += 1;
      else if (account.freeGrants.length > 0) result.singleDivisionWithGrantHistory += 1;
      else result.singleDivisionWithoutGrant += 1;
    }
  }
  return result;
}

export async function reconcileFreeFoundationUserInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<{ accountCreated: boolean; grantCreated: boolean }> {
  await configureRawQuerySchema(tx);
  await acquireBillingOwnerBootstrapLock(tx, userId);
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      rol: true,
      ligas: {
        select: {
          divisiones: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { id: true },
          },
        },
      },
      billingAccount: {
        select: {
          id: true,
          providerIdentities: {
            select: { revenueCatAppUserId: true, kind: true, status: true, retiredAt: true },
          },
          freeGrants: { where: { endedAt: null }, select: { divisionId: true } },
          billingPeriods: { where: { source: 'STORE' }, take: 1, select: { id: true } },
          migrationAccess: { select: { id: true } },
        },
      },
    },
  });
  if (!user) throw new FoundationBlockedError('USER_NOT_FOUND');
  if (user.rol !== 'LIGA') throw new FoundationBlockedError('ROLE_REQUIRED');
  const divisions = user.ligas.flatMap((league) => league.divisiones);
  if (divisions.length > 1) throw new FoundationBlockedError('MULTIPLE_DIVISIONS');

  let account = user.billingAccount;
  const accountCreated = !account;
  if (!account) {
    const detached = await tx.billingAccount.findFirst({
      where: { userId: null, ownerUserIdSnapshot: userId },
      select: { id: true },
    });
    if (detached) throw new FoundationBlockedError('DETACHED_ACCOUNT_CONFLICT');
    const created = await ensureBillingAccount(tx, userId);
    account = {
      id: created.id,
      providerIdentities: [{
        revenueCatAppUserId: created.id,
        kind: 'CANONICAL',
        status: 'ACTIVE',
        retiredAt: null,
      }],
      freeGrants: [],
      billingPeriods: [],
      migrationAccess: null,
    };
  } else {
    await acquireBillingAccountLock(tx, account.id);
  }

  if (!canonicalIdentityValid(account)) throw new FoundationBlockedError('CANONICAL_IDENTITY_INVALID');
  if (account.migrationAccess) throw new FoundationBlockedError('MIGRATION_STATE_CONFLICT');
  if (account.billingPeriods.length > 0 && account.freeGrants.length > 0) {
    throw new FoundationBlockedError('FREE_GRANT_CONFLICT');
  }
  if (divisions.length === 0 && account.freeGrants.length > 0) {
    throw new FoundationBlockedError('FREE_GRANT_CONFLICT');
  }
  if (divisions.length === 1 && account.freeGrants.some(({ divisionId }) => divisionId !== divisions[0].id)) {
    throw new FoundationBlockedError('FREE_GRANT_CONFLICT');
  }

  const grantCountBefore = await tx.freeManagementGrant.count({ where: { billingAccountId: account.id } });
  if (divisions.length === 1) await ensureInitialFreeManagementGrant(tx, userId, divisions[0].id);
  const grantCountAfter = await tx.freeManagementGrant.count({ where: { billingAccountId: account.id } });
  const grantCreated = grantCountAfter > grantCountBefore;
  if (accountCreated || grantCreated) {
    await tx.billingAuditLog.create({
      data: {
        action: 'BILLING_FREE_FOUNDATION_RECONCILED',
        actorType: 'SYSTEM',
        actorUserIdSnapshot: 'billing-free-foundation',
        targetType: 'BillingAccount',
        targetId: account.id,
        requestId: randomUUID(),
        metadataRedacted: {
          divisionCount: divisions.length,
          accountCreated,
          identityCreated: accountCreated,
          grantCreated,
          storeHistory: account.billingPeriods.length > 0,
        } satisfies Prisma.InputJsonObject,
      },
    });
  }
  return { accountCreated, grantCreated };
}

async function reconcileUser(
  userId: string,
  client: PrismaClient,
): Promise<{ accountCreated: boolean; grantCreated: boolean }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(
        (tx) => reconcileFreeFoundationUserInTransaction(tx, userId),
        { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 30_000 },
      );
    } catch (error) {
      if ((error as { code?: unknown })?.code === 'P2034' && attempt < 2) continue;
      if ((error as { code?: unknown })?.code === 'P2034') {
        throw new FoundationBlockedError('CONCURRENT_CHANGE');
      }
      throw error;
    }
  }
  throw new FoundationBlockedError('CONCURRENT_CHANGE');
}

export async function reconcileFreeFoundation(
  client: PrismaClient,
): Promise<FreeFoundationReconciliationResult> {
  assertDevelopmentScriptContext();
  const userIds = (await client.user.findMany({
    where: { rol: 'LIGA' },
    orderBy: { id: 'asc' },
    select: { id: true },
  })).map(({ id }) => id);
  const issueCounts = new Map<string, number>();
  const result: FreeFoundationReconciliationResult = {
    scanned: userIds.length,
    accountsCreated: 0,
    identitiesCreated: 0,
    grantsCreated: 0,
    unchanged: 0,
    blocked: 0,
    issues: [],
  };
  for (const userId of userIds) {
    try {
      const reconciled = await reconcileUser(userId, client);
      if (reconciled.accountCreated) {
        result.accountsCreated += 1;
        result.identitiesCreated += 1;
      }
      if (reconciled.grantCreated) result.grantsCreated += 1;
      if (!reconciled.accountCreated && !reconciled.grantCreated) result.unchanged += 1;
    } catch (error) {
      if (!(error instanceof FoundationBlockedError)) throw error;
      result.blocked += 1;
      increment(issueCounts, error.issueCode);
    }
  }
  result.issues = issues<FreeFoundationIssueCode>(issueCounts);
  return result;
}

export function formatFreeFoundationAudit(result: FreeFoundationAuditResult): string {
  return `Billing free foundation audit: ${Object.entries(result).map(([key, value]) => `${key}=${value}`).join(' ')}.`;
}

export function formatFreeFoundationReconciliation(result: FreeFoundationReconciliationResult): string {
  const summary = result.issues.length === 0
    ? 'none'
    : result.issues.map(({ code, count }) => `${code}=${count}`).join(',');
  return `Billing free foundation reconciliation: scanned=${result.scanned}`
    + ` accountsCreated=${result.accountsCreated} identitiesCreated=${result.identitiesCreated}`
    + ` grantsCreated=${result.grantsCreated} unchanged=${result.unchanged}`
    + ` blocked=${result.blocked} issues=${summary}.`;
}
