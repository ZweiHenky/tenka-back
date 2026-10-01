import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env', () => ({
  env: {
    BILLING_RESOURCE_ACCESS_SHADOW_ENABLED: true,
    BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED: true,
  },
}));
vi.mock('../../config/database', () => ({ prisma: {} }));
vi.mock('../../config/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import {
  assertResourceAccessInTransaction,
  observeResourceAccessShadow,
  observeResourceAccessShadowInTransaction,
} from './resourceAccessShadow';

describe('resource access enforcement', () => {
  it('allows a capability granted to an administrator', async () => {
    const tx = {
      division: {
        findUnique: vi.fn().mockResolvedValue({ id: 'division-1', liga: { userId: 'owner-1' } }),
      },
    };
    await expect(assertResourceAccessInTransaction(tx as never, {
      operation: 'division.update',
      capability: 'MANAGE_DIVISION',
      actor: { id: 'admin-1', rol: 'ADMINISTRADOR' },
      divisionId: 'division-1',
      resourceType: 'DIVISION',
    })).resolves.toBeUndefined();
  });

  it('rejects a denied decision with a stable billing code', async () => {
    const tx = {
      division: {
        findUnique: vi.fn().mockResolvedValue({ id: 'division-1', liga: { userId: 'owner-1' } }),
      },
    };
    await expect(observeResourceAccessShadowInTransaction(tx as never, {
      operation: 'division.update',
      capability: 'MANAGE_DIVISION',
      actor: { id: 'owner-2', rol: 'LIGA' },
      divisionId: 'division-1',
      resourceType: 'DIVISION',
    })).rejects.toMatchObject({ statusCode: 403, code: 'BILLING_ROLE_REQUIRED' });
  });

  it('fails closed before a nontransactional write can run', async () => {
    await expect(observeResourceAccessShadow({
      operation: 'division.update',
      capability: 'MANAGE_DIVISION',
      actor: { id: 'owner-1', rol: 'LIGA' },
      divisionId: 'division-1',
      resourceType: 'DIVISION',
    })).rejects.toMatchObject({
      statusCode: 503,
      code: 'BILLING_ENFORCEMENT_TRANSACTION_REQUIRED',
    });
  });
});
