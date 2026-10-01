import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ownerLock: vi.fn(),
  accountLock: vi.fn(),
  detach: vi.fn(),
  ensure: vi.fn().mockResolvedValue({ id: 'billing_replacement_account' }),
}));
vi.mock('../../utils/developmentDatabase', () => ({ assertDevelopmentScriptContext: vi.fn() }));
vi.mock('../../utils/rawDatabaseSchema', () => ({ configureRawQuerySchema: vi.fn() }));
vi.mock('./service', () => ({
  acquireBillingOwnerBootstrapLock: mocks.ownerLock,
  acquireBillingAccountLock: mocks.accountLock,
  detachBillingAccount: mocks.detach,
  ensureBillingAccount: mocks.ensure,
}));

import type { PrismaClient } from '../../generated/prisma/client';
import { rotateCleanDevelopmentBillingAccount } from './developmentBillingAccountRotation';

function clientFor(account: unknown) {
  const findUnique = vi.fn().mockResolvedValueOnce({ userId: 'user-1' }).mockResolvedValueOnce(account);
  const tx = { billingAccount: { findUnique }, $queryRaw: vi.fn().mockResolvedValue([]) };
  return { client: { $transaction: vi.fn((callback) => callback(tx)) } as unknown as PrismaClient };
}

describe('development billing account rotation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('detaches history and creates a new canonical account for a clean owner', async () => {
    const { client } = clientFor({
      userId: 'user-1', migrationAccess: null, user: { rol: 'LIGA', ligas: [] },
    });
    await expect(rotateCleanDevelopmentBillingAccount('billing_original_account', client))
      .resolves.toEqual({ billingAccountId: 'billing_replacement_account' });
    expect(mocks.ownerLock).toHaveBeenCalledWith(expect.anything(), 'user-1');
    expect(mocks.accountLock).toHaveBeenCalledWith(expect.anything(), 'billing_original_account');
    expect(mocks.detach).toHaveBeenCalledWith(expect.anything(), 'user-1', 'DEVELOPMENT_FIXTURE_ROTATION');
    expect(mocks.ensure).toHaveBeenCalledWith(expect.anything(), 'user-1');
  });

  it('does not rotate an owner with functional league data', async () => {
    const { client } = clientFor({
      userId: 'user-1', migrationAccess: null, user: { rol: 'LIGA', ligas: [{ id: 'league-1' }] },
    });
    await expect(rotateCleanDevelopmentBillingAccount('billing_original_account', client))
      .rejects.toThrow('functional league data');
    expect(mocks.detach).not.toHaveBeenCalled();
  });
});
