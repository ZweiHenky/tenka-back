import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { assertDevelopmentScriptContext } from '../../utils/developmentDatabase';
import { assertProductionBillingScriptContext } from '../../utils/productionDatabase';
import { configureRawQuerySchema } from '../../utils/rawDatabaseSchema';
import { acquireBillingAccountLock } from './service';

export interface BillingMigrationCandidateAudit {
  usersScanned: number;
  ligaUsers: number;
  attachedLigaAccounts: number;
  ligaWithoutAccount: number;
  ligaWithZeroDivisions: number;
  ligaWithOneDivision: number;
  ligaWithMultipleDivisions: number;
  multiDivisionAlreadyPrepared: number;
  multiDivisionCandidates: number;
  accountsWithActiveFreeGrant: number;
  accountsWithStoreHistory: number;
  accountsWithCurrentStorePeriod: number;
  canonicalIdentityIssues: number;
  incompatibleAttachedRoles: number;
  detachedAccounts: number;
}

export type BillingMigrationPreparationIssueCode =
  | 'ACCOUNT_NOT_FOUND'
  | 'DETACHED_ACCOUNT'
  | 'ROLE_REQUIRED'
  | 'CANONICAL_IDENTITY_INVALID'
  | 'INSUFFICIENT_DIVISIONS'
  | 'ACTIVE_FREE_GRANT'
  | 'PREPARATION_INCONSISTENT'
  | 'CONCURRENT_CHANGE';

export interface BillingMigrationPreparationResult {
  approved: number;
  prepared: number;
  alreadyPrepared: number;
  snapshotsCreated: number;
  blocked: number;
  issues: Array<{ code: BillingMigrationPreparationIssueCode; count: number }>;
}

export interface BillingMigrationValidationResult {
  migrationsScanned: number;
  snapshotsScanned: number;
  valid: number;
  invalid: number;
  issues: Array<{ code: string; count: number }>;
}

class PreparationBlockedError extends Error {
  constructor(readonly issueCode: BillingMigrationPreparationIssueCode) {
    super(issueCode);
  }
}

function deterministicId(prefix: string, namespace: string, value: string): string {
  return `${prefix}_${createHash('md5').update(`${namespace}:${value}`).digest('hex')}`;
}

function increment(map: Map<string, number>, code: string): void {
  map.set(code, (map.get(code) ?? 0) + 1);
}

function issueList<T extends string>(map: Map<string, number>): Array<{ code: T; count: number }> {
  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, count]) => ({ code: code as T, count }));
}

function hasValidCanonicalIdentity(account: {
  id: string;
  providerIdentities: Array<{ revenueCatAppUserId: string; kind: string; status: string }>;
}): boolean {
  const canonical = account.providerIdentities.filter(({ kind }) => kind === 'CANONICAL');
  return canonical.length === 1
    && canonical[0].status === 'ACTIVE'
    && canonical[0].revenueCatAppUserId === account.id;
}

export async function auditBillingMigrationCandidates(
  client: PrismaClient,
): Promise<BillingMigrationCandidateAudit> {
  assertDevelopmentScriptContext();
  return client.$transaction(async (tx) => {
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
    const [users, detachedAccounts] = await Promise.all([
      tx.user.findMany({
        select: {
          rol: true,
          ligas: { select: { divisiones: { select: { id: true } } } },
          billingAccount: {
            select: {
              id: true,
              providerIdentities: {
                select: { revenueCatAppUserId: true, kind: true, status: true },
              },
              freeGrants: { where: { endedAt: null }, select: { id: true } },
              billingPeriods: {
                where: { source: 'STORE' },
                select: { effectiveStart: true, effectiveEnd: true, endedEarlyAt: true },
              },
              migrationAccess: { select: { id: true } },
            },
          },
        },
      }),
      tx.billingAccount.count({ where: { userId: null } }),
    ]);

    const result: BillingMigrationCandidateAudit = {
      usersScanned: users.length,
      ligaUsers: 0,
      attachedLigaAccounts: 0,
      ligaWithoutAccount: 0,
      ligaWithZeroDivisions: 0,
      ligaWithOneDivision: 0,
      ligaWithMultipleDivisions: 0,
      multiDivisionAlreadyPrepared: 0,
      multiDivisionCandidates: 0,
      accountsWithActiveFreeGrant: 0,
      accountsWithStoreHistory: 0,
      accountsWithCurrentStorePeriod: 0,
      canonicalIdentityIssues: 0,
      incompatibleAttachedRoles: 0,
      detachedAccounts,
    };

    for (const user of users) {
      if (user.billingAccount && user.rol !== 'LIGA') result.incompatibleAttachedRoles += 1;
      if (user.rol !== 'LIGA') continue;
      result.ligaUsers += 1;
      const divisionCount = user.ligas.reduce((count, league) => count + league.divisiones.length, 0);
      if (divisionCount === 0) result.ligaWithZeroDivisions += 1;
      else if (divisionCount === 1) result.ligaWithOneDivision += 1;
      else result.ligaWithMultipleDivisions += 1;

      const account = user.billingAccount;
      if (!account) {
        result.ligaWithoutAccount += 1;
        continue;
      }
      result.attachedLigaAccounts += 1;
      if (!hasValidCanonicalIdentity(account)) result.canonicalIdentityIssues += 1;
      if (account.freeGrants.length > 0) result.accountsWithActiveFreeGrant += 1;
      if (account.billingPeriods.length > 0) result.accountsWithStoreHistory += 1;
      if (account.billingPeriods.some((period) => period.effectiveStart <= now
        && period.effectiveEnd > now && (!period.endedEarlyAt || period.endedEarlyAt > now))) {
        result.accountsWithCurrentStorePeriod += 1;
      }
      if (divisionCount > 1) {
        if (account.migrationAccess) result.multiDivisionAlreadyPrepared += 1;
        else result.multiDivisionCandidates += 1;
      }
    }
    return result;
  }, { isolationLevel: 'RepeatableRead', maxWait: 5_000, timeout: 30_000 });
}

async function prepareOneAccount(
  billingAccountId: string,
  client: PrismaClient,
): Promise<{ prepared: boolean; snapshotCount: number }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(async (tx) => {
        await configureRawQuerySchema(tx);
        await acquireBillingAccountLock(tx, billingAccountId);
        await tx.$queryRaw`SELECT "id" FROM billing_accounts WHERE "id" = ${billingAccountId} FOR UPDATE`;

        const account = await tx.billingAccount.findUnique({
          where: { id: billingAccountId },
          select: {
            id: true,
            userId: true,
            user: {
              select: {
                rol: true,
                ligas: {
                  select: {
                    divisiones: {
                      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                      select: { id: true, createdAt: true, ligaId: true },
                    },
                  },
                },
              },
            },
            providerIdentities: {
              select: { revenueCatAppUserId: true, kind: true, status: true },
            },
            freeGrants: { where: { endedAt: null }, select: { id: true } },
            migrationAccess: {
              include: { divisions: { orderBy: [{ divisionCreatedAtSnapshot: 'asc' }, { divisionIdSnapshot: 'asc' }] } },
            },
          },
        });
        if (!account) throw new PreparationBlockedError('ACCOUNT_NOT_FOUND');
        if (!account.userId || !account.user) throw new PreparationBlockedError('DETACHED_ACCOUNT');
        if (account.user.rol !== 'LIGA') throw new PreparationBlockedError('ROLE_REQUIRED');
        if (!hasValidCanonicalIdentity(account)) throw new PreparationBlockedError('CANONICAL_IDENTITY_INVALID');

        if (account.migrationAccess) {
          const migration = account.migrationAccess;
          const lifecycleIsEmpty = migration.status === 'PREPARED'
            && !migration.startedAt && !migration.deadline && !migration.activatedAt
            && !migration.appliedAt && !migration.selectedFreeDivisionIdSnapshot;
          if (!lifecycleIsEmpty || migration.divisions.length !== migration.preparedDivisionCount) {
            throw new PreparationBlockedError('PREPARATION_INCONSISTENT');
          }
          return { prepared: false, snapshotCount: 0 };
        }
        if (account.freeGrants.length > 0) throw new PreparationBlockedError('ACTIVE_FREE_GRANT');

        const divisions = account.user.ligas.flatMap((league) => league.divisiones)
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
        if (divisions.length <= 1) throw new PreparationBlockedError('INSUFFICIENT_DIVISIONS');

        const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
        const migrationId = deterministicId('billing_migration', 'tenka-billing-migration', account.id);
        await tx.billingMigrationAccess.create({
          data: {
            id: migrationId,
            billingAccountId: account.id,
            status: 'PREPARED',
            preparedAt: now,
            preparedDivisionCount: divisions.length,
            divisions: {
              create: divisions.map((division) => ({
                id: deterministicId('billing_migration_division', migrationId, division.id),
                divisionId: division.id,
                divisionIdSnapshot: division.id,
                divisionCreatedAtSnapshot: division.createdAt,
                leagueIdSnapshot: division.ligaId,
              })),
            },
          },
        });
        await tx.billingAuditLog.create({
          data: {
            action: 'BILLING_MIGRATION_PREPARED',
            actorType: 'SYSTEM',
            actorUserIdSnapshot: 'billing-migration-preparation',
            targetType: 'BillingMigrationAccess',
            targetId: migrationId,
            requestId: randomUUID(),
            metadataRedacted: { divisionCount: divisions.length } satisfies Prisma.InputJsonObject,
          },
        });
        return { prepared: true, snapshotCount: divisions.length };
      }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 30_000 });
    } catch (error) {
      if ((error as { code?: unknown })?.code === 'P2034' && attempt < 2) continue;
      if ((error as { code?: unknown })?.code === 'P2034') {
        throw new PreparationBlockedError('CONCURRENT_CHANGE');
      }
      throw error;
    }
  }
  throw new PreparationBlockedError('CONCURRENT_CHANGE');
}

export async function prepareBillingMigrationCohort(
  billingAccountIds: readonly string[],
  client: PrismaClient,
): Promise<BillingMigrationPreparationResult> {
  assertDevelopmentScriptContext();
  return prepareApprovedBillingMigrationCohort(billingAccountIds, client);
}

export async function prepareBillingMigrationCohortForProduction(
  billingAccountIds: readonly string[],
  client: PrismaClient,
): Promise<BillingMigrationPreparationResult> {
  assertProductionBillingScriptContext();
  return prepareApprovedBillingMigrationCohort(billingAccountIds, client);
}

async function prepareApprovedBillingMigrationCohort(
  billingAccountIds: readonly string[],
  client: PrismaClient,
): Promise<BillingMigrationPreparationResult> {
  if (billingAccountIds.length < 1 || billingAccountIds.length > 10
    || new Set(billingAccountIds).size !== billingAccountIds.length
    || billingAccountIds.some((id) => !/^billing_[A-Za-z0-9_-]{8,100}$/.test(id))) {
    throw new Error('The approved billing migration cohort must contain 1 to 10 unique canonical accounts');
  }
  const issues = new Map<string, number>();
  const result: BillingMigrationPreparationResult = {
    approved: billingAccountIds.length,
    prepared: 0,
    alreadyPrepared: 0,
    snapshotsCreated: 0,
    blocked: 0,
    issues: [],
  };
  for (const billingAccountId of billingAccountIds) {
    try {
      const accountResult = await prepareOneAccount(billingAccountId, client);
      if (accountResult.prepared) {
        result.prepared += 1;
        result.snapshotsCreated += accountResult.snapshotCount;
      } else {
        result.alreadyPrepared += 1;
      }
    } catch (error) {
      if (!(error instanceof PreparationBlockedError)) throw error;
      result.blocked += 1;
      increment(issues, error.issueCode);
    }
  }
  result.issues = issueList<BillingMigrationPreparationIssueCode>(issues);
  return result;
}

export async function validateBillingMigrationPreparation(
  client: PrismaClient,
): Promise<BillingMigrationValidationResult> {
  assertDevelopmentScriptContext();
  const migrations = await client.billingMigrationAccess.findMany({
    include: {
      billingAccount: {
        select: {
          id: true,
          userId: true,
          user: { select: { rol: true } },
          providerIdentities: { select: { revenueCatAppUserId: true, kind: true, status: true } },
        },
      },
      divisions: {
        select: {
          divisionId: true,
          divisionIdSnapshot: true,
          divisionCreatedAtSnapshot: true,
          leagueIdSnapshot: true,
          division: { select: { id: true, createdAt: true, ligaId: true, liga: { select: { userId: true } } } },
        },
      },
    },
  });
  const issues = new Map<string, number>();
  let valid = 0;
  let snapshotsScanned = 0;
  for (const migration of migrations) {
    const before = [...issues.values()].reduce((sum, count) => sum + count, 0);
    snapshotsScanned += migration.divisions.length;
    if (!migration.billingAccount.userId) increment(issues, 'DETACHED_ACCOUNT');
    if (migration.billingAccount.user?.rol !== 'LIGA') increment(issues, 'ROLE_REQUIRED');
    if (!hasValidCanonicalIdentity(migration.billingAccount)) increment(issues, 'CANONICAL_IDENTITY_INVALID');
    if (migration.status !== 'PREPARED' || migration.startedAt || migration.deadline
      || migration.activatedAt || migration.appliedAt || migration.selectedFreeDivisionIdSnapshot) {
      increment(issues, 'PREPARED_STATE_INVALID');
    }
    if (migration.divisions.length !== migration.preparedDivisionCount) increment(issues, 'SNAPSHOT_COUNT_MISMATCH');
    for (const snapshot of migration.divisions) {
      if (snapshot.division && (
        snapshot.division.id !== snapshot.divisionIdSnapshot
        || snapshot.division.ligaId !== snapshot.leagueIdSnapshot
        || snapshot.division.createdAt.getTime() !== snapshot.divisionCreatedAtSnapshot.getTime()
        || snapshot.division.liga.userId !== migration.billingAccount.userId
      )) increment(issues, 'LIVE_SNAPSHOT_MISMATCH');
    }
    const after = [...issues.values()].reduce((sum, count) => sum + count, 0);
    if (before === after) valid += 1;
  }
  return {
    migrationsScanned: migrations.length,
    snapshotsScanned,
    valid,
    invalid: migrations.length - valid,
    issues: issueList(issues),
  };
}

export function formatBillingMigrationCandidateAudit(result: BillingMigrationCandidateAudit): string {
  return `Billing migration candidate audit: ${Object.entries(result).map(([key, value]) => `${key}=${value}`).join(' ')}.`;
}

export function formatBillingMigrationPreparationResult(result: BillingMigrationPreparationResult): string {
  const issues = result.issues.length === 0 ? 'none' : result.issues.map(({ code, count }) => `${code}=${count}`).join(',');
  return `Billing migration preparation: approved=${result.approved} prepared=${result.prepared}`
    + ` alreadyPrepared=${result.alreadyPrepared} snapshotsCreated=${result.snapshotsCreated}`
    + ` blocked=${result.blocked} issues=${issues}.`;
}

export function formatBillingMigrationValidationResult(result: BillingMigrationValidationResult): string {
  const issues = result.issues.length === 0 ? 'none' : result.issues.map(({ code, count }) => `${code}=${count}`).join(',');
  return `Billing migration validation: migrationsScanned=${result.migrationsScanned}`
    + ` snapshotsScanned=${result.snapshotsScanned} valid=${result.valid}`
    + ` invalid=${result.invalid} issues=${issues}.`;
}
