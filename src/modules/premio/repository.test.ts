import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  premioFindFirst: vi.fn(),
  divisionFindFirst: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  prisma: {
    premio: { findFirst: mocks.premioFindFirst },
    division: { findFirst: mocks.divisionFindFirst },
  },
}));

import { premioRepository } from './repository';
import type { AuthenticatedUser } from '../../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };

describe('premioRepository public reads', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gets a premio with embedded division visibility in one query', async () => {
    const premio = { id: 'premio-1', divisionId: 'division-1' };
    mocks.premioFindFirst.mockResolvedValue(premio);

    await expect(premioRepository.findVisibleById('premio-1', owner)).resolves.toBe(premio);
    expect(mocks.premioFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.premioFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'premio-1',
        division: { OR: [
          { estadoLiga: { codigo: { not: 'BORRADOR' } } },
          { liga: { userId: owner.id } },
        ] },
      },
    });
  });

  it('loads ordered premios through one visible parent query', async () => {
    const premios = [{ id: 'premio-1' }, { id: 'premio-2' }];
    mocks.divisionFindFirst.mockResolvedValue({ premios });

    await expect(premioRepository.findVisibleByDivision('division-1')).resolves.toBe(premios);
    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.divisionFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'division-1',
        estadoLiga: { codigo: { not: 'BORRADOR' } },
      },
      select: { premios: { orderBy: { posicion: 'asc' } } },
    });
  });

  it('distinguishes a visible empty division from a hidden or missing division', async () => {
    mocks.divisionFindFirst.mockResolvedValueOnce({ premios: [] }).mockResolvedValueOnce(null);

    await expect(premioRepository.findVisibleByDivision('visible')).resolves.toEqual([]);
    await expect(premioRepository.findVisibleByDivision('hidden-or-missing')).resolves.toBeNull();
  });
});
