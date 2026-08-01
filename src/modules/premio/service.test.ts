import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findVisibleById: vi.fn(),
  findVisibleByDivision: vi.fn(),
}));

vi.mock('./repository', () => ({ premioRepository: mocks }));
vi.mock('../../config/database', () => ({ prisma: {} }));

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
