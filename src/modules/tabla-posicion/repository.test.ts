import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ divisionFindFirst: vi.fn() }));

vi.mock('../../config/database', () => ({
  prisma: {
    division: { findFirst: mocks.divisionFindFirst },
  },
}));

import { tablaPosicionRepository } from './repository';
import type { AuthenticatedUser } from '../../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };

describe('tablaPosicionRepository public reads', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [undefined, { estadoLiga: { codigo: { not: 'BORRADOR' } } }],
    [owner, { OR: [
      { estadoLiga: { codigo: { not: 'BORRADOR' } } },
      { liga: { userId: owner.id } },
    ] }],
    [admin, {}],
  ])('selects only standings from the visible parent for actor %#', async (actor, visibility) => {
    mocks.divisionFindFirst.mockResolvedValue({ tablaPosiciones: [] });

    await tablaPosicionRepository.findByDivision('division-1', actor);

    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.divisionFindFirst).toHaveBeenCalledWith({
      where: { id: 'division-1', ...visibility },
      select: {
        tablaPosiciones: {
          include: { equipo: { select: { id: true, nombre: true, logo: true } } },
          orderBy: { puntos: 'desc' },
        },
      },
    });

    await tablaPosicionRepository.findTeamsByDivision('division-1', actor);
    expect(mocks.divisionFindFirst).toHaveBeenLastCalledWith({
      where: { id: 'division-1', ...visibility },
      select: {
        equipos: {
          select: {
            equipoId: true,
            equipo: { select: { id: true, nombre: true, logo: true } },
          },
        },
      },
    });
  });

  it.each([
    [undefined, { estadoLiga: { codigo: { not: 'BORRADOR' } } }],
    [owner, { OR: [
      { estadoLiga: { codigo: { not: 'BORRADOR' } } },
      { liga: { userId: owner.id } },
    ] }],
    [admin, {}],
  ])('selects one standing from one visible parent for actor %#', async (actor, visibility) => {
    mocks.divisionFindFirst.mockResolvedValue({ tablaPosiciones: [] });

    await tablaPosicionRepository.findOne('division-1', 'team-1', actor);

    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.divisionFindFirst).toHaveBeenCalledWith({
      where: { id: 'division-1', ...visibility },
      select: { tablaPosiciones: { where: { equipoId: 'team-1' } } },
    });
  });
});
