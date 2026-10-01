import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/developmentDatabase', () => ({ assertDevelopmentScriptContext: vi.fn() }));

import {
  auditFreeFoundation,
  formatFreeFoundationAudit,
  formatFreeFoundationReconciliation,
  reconcileFreeFoundation,
} from './freeFoundationReconciliation';

describe('billing free foundation reconciliation', () => {
  it('classifies missing accounts and grant gaps without exposing identities', async () => {
    const client = {
      user: { findMany: vi.fn().mockResolvedValue([
        { id: 'private-zero', ligas: [], billingAccount: null },
        {
          id: 'private-one',
          ligas: [{ divisiones: [{ id: 'private-division' }] }],
          billingAccount: null,
        },
        {
          id: 'private-attached',
          ligas: [{ divisiones: [{ id: 'attached-division' }] }],
          billingAccount: {
            id: 'billing-private',
            providerIdentities: [{
              revenueCatAppUserId: 'billing-private', kind: 'CANONICAL', status: 'ACTIVE', retiredAt: null,
            }],
            freeGrants: [],
            billingPeriods: [],
            migrationAccess: null,
          },
        },
      ]) },
      billingAccount: { findMany: vi.fn().mockResolvedValue([{ ownerUserIdSnapshot: 'private-zero' }]) },
    } as never;

    const result = await auditFreeFoundation(client);

    expect(result).toMatchObject({
      ligaUsers: 3,
      attachedAccounts: 1,
      missingAccounts: 2,
      missingAccountZeroDivisions: 1,
      missingAccountOneDivision: 1,
      singleDivisionWithoutGrant: 1,
      detachedOwnerConflicts: 1,
    });
    const formatted = formatFreeFoundationAudit(result);
    expect(formatted).not.toContain('private-zero');
    expect(formatted).not.toContain('private-one');
    expect(formatted).not.toContain('billing-private');
  });

  it('reports multidivision accounts as blocking without leaking the user ID', async () => {
    const tx = {
      $queryRaw: vi.fn(),
      $executeRawUnsafe: vi.fn(),
      user: { findUnique: vi.fn().mockResolvedValue({
        rol: 'LIGA',
        ligas: [{ divisiones: [{ id: 'division-1' }, { id: 'division-2' }] }],
        billingAccount: null,
      }) },
    };
    const client = {
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'private-user' }]) },
      $transaction: vi.fn((callback) => callback(tx)),
    } as never;

    const result = await reconcileFreeFoundation(client);

    expect(result).toMatchObject({ scanned: 1, blocked: 1, accountsCreated: 0, grantsCreated: 0 });
    expect(result.issues).toEqual([{ code: 'MULTIPLE_DIVISIONS', count: 1 }]);
    expect(formatFreeFoundationReconciliation(result)).not.toContain('private-user');
  });
});
