import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findVisibleById: vi.fn(),
  findVisibleByDivision: vi.fn(),
  findById: vi.fn(),
  divisionFindUnique: vi.fn(),
  divisionFindFirst: vi.fn(),
  premioCreate: vi.fn(),
  premioUpdate: vi.fn(),
  premioDelete: vi.fn(),
  transaction: vi.fn(),
  observe: vi.fn(),
}));

vi.mock('./repository', () => ({ premioRepository: mocks }));
vi.mock('../../config/database', () => ({
  prisma: {
    division: { findUnique: mocks.divisionFindUnique, findFirst: mocks.divisionFindFirst },
    $transaction: mocks.transaction,
  },
}));
vi.mock('../billing/resourceAccessShadow', () => ({
  observeResourceAccessShadowInTransaction: mocks.observe,
}));

import { premioService } from './service';
import type { AuthenticatedUser } from '../../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };

describe('premioService public reads', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gets visible detail in one repository operation and preserves its shape', async () => {
    const premio = { id: 'premio-1', posicion: 1, divisionId: 'division-1' };
    mocks.findVisibleById.mockResolvedValue(premio);

    await expect(premioService.getById('premio-1', owner)).resolves.toBe(premio);
    expect(mocks.findVisibleById).toHaveBeenCalledTimes(1);
    expect(mocks.findVisibleById).toHaveBeenCalledWith('premio-1', owner);
  });

  it('returns 404 for a hidden or missing premio', async () => {
    mocks.findVisibleById.mockResolvedValue(null);
    await expect(premioService.getById('premio-1')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Premio no encontrado',
    });
  });

  it('returns an empty list for a visible division in one repository operation', async () => {
    mocks.findVisibleByDivision.mockResolvedValue([]);
    await expect(premioService.findByDivision('division-1', owner)).resolves.toEqual([]);
    expect(mocks.findVisibleByDivision).toHaveBeenCalledTimes(1);
    expect(mocks.findVisibleByDivision).toHaveBeenCalledWith('division-1', owner);
  });

  it('returns 404 for a hidden or missing division', async () => {
    mocks.findVisibleByDivision.mockResolvedValue(null);
    await expect(premioService.findByDivision('division-1')).rejects.toMatchObject({
      statusCode: 404,
      message: 'División no encontrado',
    });
  });
});

describe('premioService writes', () => {
  const tx = {
    premio: { create: mocks.premioCreate, update: mocks.premioUpdate, delete: mocks.premioDelete },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
    mocks.divisionFindUnique.mockResolvedValue({ liga: { userId: owner.id } });
    mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1' });
    mocks.findById.mockResolvedValue({ id: 'premio-1', divisionId: 'division-1' });
  });

  it('gates create in the same transaction before writing and preserves the result', async () => {
    const created = { id: 'premio-1', divisionId: 'division-1', posicion: 1, titulo: 'Campeón' };
    mocks.premioCreate.mockResolvedValue(created);

    await expect(premioService.create({ divisionId: 'division-1', posicion: 1, titulo: 'Campeón' }, owner)).resolves.toBe(created);

    expect(mocks.observe).toHaveBeenCalledWith(tx, expect.objectContaining({ operation: 'prize.create', divisionId: 'division-1' }));
    expect(mocks.observe.mock.invocationCallOrder[0]).toBeLessThan(mocks.premioCreate.mock.invocationCallOrder[0]);
  });

  it('gates update and delete before their writes', async () => {
    mocks.premioUpdate.mockResolvedValue({ id: 'premio-1', divisionId: 'division-1' });

    await premioService.update('premio-1', { titulo: 'Nuevo' }, owner);
    expect(mocks.observe.mock.invocationCallOrder[0]).toBeLessThan(mocks.premioUpdate.mock.invocationCallOrder[0]);

    mocks.observe.mockClear();
    await premioService.delete('premio-1', owner);
    expect(mocks.observe).toHaveBeenCalledWith(tx, expect.objectContaining({ operation: 'prize.delete', divisionId: 'division-1' }));
    expect(mocks.observe.mock.invocationCallOrder[0]).toBeLessThan(mocks.premioDelete.mock.invocationCallOrder[0]);
  });
});
