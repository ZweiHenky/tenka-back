import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/developmentDatabase', () => ({ assertDevelopmentScriptContext: vi.fn() }));
vi.mock('../../utils/productionDatabase', () => ({ assertProductionBillingScriptContext: vi.fn() }));

import {
  auditBillingMigrationCandidates,
  formatBillingMigrationPreparationResult,
  prepareBillingMigrationCohort,
  prepareBillingMigrationCohortForProduction,
  validateBillingMigrationPreparation,
} from './migrationPreparation';

const NOW = new Date('2026-09-25T12:00:00Z');

function rawQuery(strings: TemplateStringsArray) {
  return Promise.resolve(strings.join('').includes('NOW()') ? [{ now: NOW }] : []);
}

describe('billing migration preparation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('audits candidates without writing or exposing account identities', async () => {
    const tx = {
      $queryRaw: vi.fn(rawQuery),
      user: { findMany: vi.fn().mockResolvedValue([
        {
          rol: 'LIGA',
          ligas: [{ divisiones: [{ id: 'division-1' }, { id: 'division-2' }] }],
          billingAccount: {
            id: 'billing-private',
            providerIdentities: [{ revenueCatAppUserId: 'billing-private', kind: 'CANONICAL', status: 'ACTIVE' }],
            freeGrants: [],
            billingPeriods: [],
            migrationAccess: null,
          },
        },
        { rol: 'CAPITAN', ligas: [], billingAccount: null },
      ]) },
      billingAccount: { count: vi.fn().mockResolvedValue(1) },
    };
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as never;

    await expect(auditBillingMigrationCandidates(client)).resolves.toMatchObject({
      usersScanned: 2,
      ligaUsers: 1,
      ligaWithMultipleDivisions: 1,
      multiDivisionCandidates: 1,
      detachedAccounts: 1,
    });
    expect(JSON.stringify(await auditBillingMigrationCandidates(client))).not.toContain('billing-private');
  });

  it('prepares an approved account once with deterministic snapshots and no deadline', async () => {
    const createMigration = vi.fn().mockResolvedValue({ id: 'migration-1' });
    const createAudit = vi.fn().mockResolvedValue({ id: 'audit-1' });
    const account = {
      id: 'billing_approved_account',
      userId: 'owner-1',
      user: {
        rol: 'LIGA',
        ligas: [{ divisiones: [
          { id: 'division-2', createdAt: new Date('2026-01-02T00:00:00Z'), ligaId: 'league-1' },
          { id: 'division-1', createdAt: new Date('2026-01-01T00:00:00Z'), ligaId: 'league-1' },
        ] }],
      },
      providerIdentities: [{ revenueCatAppUserId: 'billing_approved_account', kind: 'CANONICAL', status: 'ACTIVE' }],
      freeGrants: [],
      migrationAccess: null,
    };
    const tx = {
      $executeRawUnsafe: vi.fn(),
      $queryRaw: vi.fn(rawQuery),
      billingAccount: { findUnique: vi.fn().mockResolvedValue(account) },
      billingMigrationAccess: { create: createMigration },
      billingAuditLog: { create: createAudit },
    };
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as never;

    const result = await prepareBillingMigrationCohort(['billing_approved_account'], client);

    expect(result).toEqual({
      approved: 1, prepared: 1, alreadyPrepared: 0, snapshotsCreated: 2, blocked: 0, issues: [],
    });
    expect(createMigration).toHaveBeenCalledWith({ data: expect.objectContaining({
      status: 'PREPARED',
      preparedAt: NOW,
      preparedDivisionCount: 2,
      divisions: { create: [
        expect.objectContaining({ divisionId: 'division-1', divisionIdSnapshot: 'division-1' }),
        expect.objectContaining({ divisionId: 'division-2', divisionIdSnapshot: 'division-2' }),
      ] },
    }) });
    expect(createAudit).toHaveBeenCalledTimes(1);
  });

  it('fails closed per account and reports only aggregated issue codes', async () => {
    const tx = {
      $executeRawUnsafe: vi.fn(),
      $queryRaw: vi.fn(rawQuery),
      billingAccount: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as never;

    const result = await prepareBillingMigrationCohort(['billing_missing_account'], client);

    expect(result).toMatchObject({ approved: 1, prepared: 0, blocked: 1 });
    expect(result.issues).toEqual([{ code: 'ACCOUNT_NOT_FOUND', count: 1 }]);
    expect(formatBillingMigrationPreparationResult(result)).not.toContain('billing_missing_account');
  });

  it('rejects non-canonical, duplicate, empty and oversized cohorts before querying', async () => {
    const transaction = vi.fn();
    const client = { $transaction: transaction } as never;
    await expect(prepareBillingMigrationCohort([], client)).rejects.toThrow('1 to 10');
    await expect(prepareBillingMigrationCohort(['billing_account01', 'billing_account01'], client))
      .rejects.toThrow('unique canonical accounts');
    await expect(prepareBillingMigrationCohort(['anonymous-user'], client)).rejects.toThrow('canonical accounts');
    await expect(prepareBillingMigrationCohort(
      Array.from({ length: 11 }, (_, index) => `billing_account${index}`), client,
    )).rejects.toThrow('1 to 10');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('uses the same preparation path behind the independent production guard', async () => {
    const tx = {
      $executeRawUnsafe: vi.fn(),
      $queryRaw: vi.fn(rawQuery),
      billingAccount: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as never;
    await expect(prepareBillingMigrationCohortForProduction(['billing_missing_account'], client))
      .resolves.toMatchObject({ approved: 1, blocked: 1 });
  });

  it('validates PREPARED rows and live snapshot ownership read-only', async () => {
    const client = {
      billingMigrationAccess: { findMany: vi.fn().mockResolvedValue([{
        status: 'PREPARED', preparedDivisionCount: 2, selectedFreeDivisionIdSnapshot: null,
        startedAt: null, deadline: null, activatedAt: null, appliedAt: null,
        billingAccount: {
          id: 'billing-1', userId: 'owner-1', user: { rol: 'LIGA' },
          providerIdentities: [{ revenueCatAppUserId: 'billing-1', kind: 'CANONICAL', status: 'ACTIVE' }],
        },
        divisions: ['1', '2'].map((suffix) => ({
          divisionId: `division-${suffix}`, divisionIdSnapshot: `division-${suffix}`,
          divisionCreatedAtSnapshot: NOW, leagueIdSnapshot: 'league-1',
          division: { id: `division-${suffix}`, createdAt: NOW, ligaId: 'league-1', liga: { userId: 'owner-1' } },
        })),
      }]) },
    } as never;

    await expect(validateBillingMigrationPreparation(client)).resolves.toEqual({
      migrationsScanned: 1, snapshotsScanned: 2, valid: 1, invalid: 0, issues: [],
    });
  });
});
