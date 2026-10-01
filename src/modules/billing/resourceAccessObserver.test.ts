import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock('../../config/env', () => ({
  env: { BILLING_RESOURCE_ACCESS_SHADOW_ENABLED: true },
}));
vi.mock('../../config/logger', () => ({ logger }));

import { observeResourceAccessShadowInTransaction } from './resourceAccessShadow';

describe('resource access shadow observer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs a sanitized decision without resource or owner identifiers', async () => {
    const tx = {
      division: {
        findUnique: vi.fn().mockResolvedValue({ id: 'division-secret', liga: { userId: 'owner-secret' } }),
      },
    };

    await observeResourceAccessShadowInTransaction(tx as never, {
      operation: 'division.update',
      capability: 'MANAGE_DIVISION',
      actor: { id: 'admin-secret', rol: 'ADMINISTRADOR' },
      divisionId: 'division-secret',
      resourceType: 'DIVISION',
    });

    expect(logger.info).toHaveBeenCalledOnce();
    const fields = logger.info.mock.calls[0][0];
    expect(fields).toMatchObject({
      capability: 'MANAGE_DIVISION',
      access: 'FULL',
      reason: 'ADMIN',
      basis: 'ADMIN',
      wouldAllow: true,
    });
    expect(JSON.stringify(fields)).not.toMatch(/division-secret|owner-secret|admin-secret/);
  });

  it('fails open and records only an error classification', async () => {
    const tx = {
      division: { findUnique: vi.fn().mockRejectedValue(new Error('database unavailable')) },
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    };

    await expect(observeResourceAccessShadowInTransaction(tx as never, {
      operation: 'division.update',
      capability: 'MANAGE_DIVISION',
      divisionId: 'division-secret',
      resourceType: 'DIVISION',
    })).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledOnce();
    const fields = logger.warn.mock.calls[0][0];
    expect(fields).toMatchObject({
      capability: 'MANAGE_DIVISION',
      access: 'BLOCKED',
      reason: 'INVALID_BILLING_EVIDENCE',
      wouldAllow: false,
    });
    expect(JSON.stringify(fields)).not.toContain('division-secret');
    expect(tx.$executeRawUnsafe.mock.calls.map(([statement]) => statement)).toEqual([
      'SAVEPOINT billing_resource_access_shadow',
      'ROLLBACK TO SAVEPOINT billing_resource_access_shadow',
      'RELEASE SAVEPOINT billing_resource_access_shadow',
    ]);
  });
});
