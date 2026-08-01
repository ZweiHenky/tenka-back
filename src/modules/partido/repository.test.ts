import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  partidoFindMany: vi.fn(),
  jornadaFindFirst: vi.fn(),
  rondaPlayoffFindFirst: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  prisma: {
    partido: { findMany: mocks.partidoFindMany },
    jornada: { findFirst: mocks.jornadaFindFirst },
    rondaPlayoff: { findFirst: mocks.rondaPlayoffFindFirst },
  },
}));

import { partidoRepository } from './repository';
import type { AuthenticatedUser } from '../../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
const published = { estadoLiga: { nombre: { not: 'Borrador' } } };
const partido = {
  id: 'partido-1',
  golesLocal: 2,
  golesVisitante: 1,
  equipoLocal: { id: 'local-1', nombre: 'Local', logo: null },
  equipoVisitante: { id: 'visitante-1', nombre: 'Visitante', logo: 'logo.png' },
  cancha: { id: 'cancha-1', nombre: 'Central' },
  arbitros: [{ arbitro: { id: 'arbitro-1', nombre: 'Alex' } }],
};

describe('partidoRepository public reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.partidoFindMany.mockResolvedValue([partido]);
    mocks.jornadaFindFirst.mockResolvedValue({ partidos: [partido] });
    mocks.rondaPlayoffFindFirst.mockResolvedValue({ partidos: [partido] });
  });

  it.each([
    ['anonymous', undefined, published],
    ['owner', owner, { OR: [published, { liga: { userId: owner.id } }] }],
    ['admin', admin, {}],
  ])('lists visible partidos for %s in one domain query', async (_label, actor, visibility) => {
    const result = await partidoRepository.findAllVisible(actor);

    expect(mocks.partidoFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.partidoFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [
        { jornada: { division: visibility } },
        { rondaPlayoff: { division: visibility } },
      ] },
    }));
    expect(result[0]).toMatchObject({ ...partido, arbitros: [{ id: 'arbitro-1', nombre: 'Alex' }] });
  });

  it.each([
    ['jornada', partidoRepository.findVisibleByJornada, mocks.jornadaFindFirst],
    ['ronda playoff', partidoRepository.findVisibleByRondaPlayoff, mocks.rondaPlayoffFindFirst],
  ] as const)('loads a visible %s and its partidos in one parent query', async (_label, method, findFirst) => {
    const result = await method('parent-1', owner);

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'parent-1',
        division: { OR: [published, { liga: { userId: owner.id } }] },
      },
      select: { partidos: { include: expect.any(Object) } },
    }));
    expect(result?.[0]).toMatchObject({ ...partido, arbitros: [{ id: 'arbitro-1', nombre: 'Alex' }] });
  });

  it.each([
    ['anonymous', undefined, published],
    ['admin', admin, {}],
  ])('applies %s visibility to both parent query shapes', async (_label, actor, visibility) => {
    await partidoRepository.findVisibleByJornada('jornada-1', actor);
    await partidoRepository.findVisibleByRondaPlayoff('ronda-1', actor);

    expect(mocks.jornadaFindFirst.mock.calls[0][0].where.division).toEqual(visibility);
    expect(mocks.rondaPlayoffFindFirst.mock.calls[0][0].where.division).toEqual(visibility);
  });

  it.each([
    ['jornada', partidoRepository.findVisibleByJornada, mocks.jornadaFindFirst],
    ['ronda playoff', partidoRepository.findVisibleByRondaPlayoff, mocks.rondaPlayoffFindFirst],
  ] as const)('distinguishes a visible empty %s from a hidden or missing parent', async (_label, method, findFirst) => {
    findFirst.mockResolvedValueOnce({ partidos: [] }).mockResolvedValueOnce(null);

    await expect(method('visible')).resolves.toEqual([]);
    await expect(method('hidden-or-missing')).resolves.toBeNull();
  });
});
