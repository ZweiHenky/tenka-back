import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  partidoFindMany: vi.fn(),
  partidoFindUnique: vi.fn(),
  partidoFindFirst: vi.fn(),
  jornadaFindFirst: vi.fn(),
  rondaPlayoffFindFirst: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  prisma: {
    partido: { findMany: mocks.partidoFindMany, findUnique: mocks.partidoFindUnique, findFirst: mocks.partidoFindFirst },
    jornada: { findFirst: mocks.jornadaFindFirst },
    rondaPlayoff: { findFirst: mocks.rondaPlayoffFindFirst },
  },
}));

import { partidoRepository } from './repository';
import type { AuthenticatedUser } from '../../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const other: AuthenticatedUser = { id: 'other-1', email: 'other@test.com', rol: 'LIGA' };
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
    mocks.partidoFindUnique.mockResolvedValue(partido);
    mocks.partidoFindFirst.mockResolvedValue(partido);
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

  it('exposes participaciones with snapshot id fallback in detail reads', async () => {
    mocks.partidoFindUnique.mockResolvedValue({
      ...partido,
      participaciones: [{
        id: 'part-1',
        jugadorId: null,
        equipoId: null,
        jugadorIdSnapshot: 'player-1',
        equipoIdSnapshot: 'team-1',
        ladoMarcador: 'LOCAL',
        jugadorNombre: 'Ana',
        equipoNombre: 'Locales',
        dorsal: 9,
      }],
    });

    const result = await partidoRepository.findById('partido-1');

    expect(mocks.partidoFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({ participaciones: expect.any(Object) }),
    }));
    expect(result?.participaciones).toEqual([expect.objectContaining({ jugadorId: 'player-1', equipoId: 'team-1' })]);
    expect(result?.participaciones?.[0]).not.toHaveProperty('jugadorIdSnapshot');
    expect(result?.participaciones?.[0]).not.toHaveProperty('equipoIdSnapshot');
  });

  it('exposes scorer snapshots through public fields without internal snapshot ids', async () => {
    mocks.partidoFindFirst.mockResolvedValue({
      ...partido,
      anotaciones: [{
        id: 'goal-1', jugadorId: null, equipoId: null, jugadorIdSnapshot: 'player-1', equipoIdSnapshot: 'team-1',
        ladoMarcador: 'LOCAL', cantidad: 2, jugadorNombre: 'Ana', equipoNombre: 'Locales', dorsal: 9,
      }],
    });

    const result = await partidoRepository.findVisibleById('partido-1');

    expect(result?.anotaciones?.[0]).toEqual({
      id: 'goal-1', jugadorId: 'player-1', equipoId: 'team-1', ladoMarcador: 'LOCAL', cantidad: 2,
      jugadorNombre: 'Ana', equipoNombre: 'Locales', dorsal: 9,
    });
    expect(result?.anotaciones?.[0]).not.toHaveProperty('jugadorIdSnapshot');
  });

  it('exposes private notas only to the league owner and strips them from other reads', async () => {
    const withNotas = {
      ...partido,
      notas: 'Solo dueño y árbitro',
      jornada: { division: { liga: { userId: 'owner-1' } } },
    };

    mocks.partidoFindFirst.mockResolvedValue(withNotas);
    const ownerResult = await partidoRepository.findVisibleById('partido-1', owner);
    expect(ownerResult?.notas).toBe('Solo dueño y árbitro');

    mocks.partidoFindFirst.mockResolvedValue({ ...withNotas, jornada: { division: { liga: { userId: 'someone-else' } } } });
    const stranger = await partidoRepository.findVisibleById('partido-1', other);
    expect(stranger?.notas).toBeUndefined();

    mocks.partidoFindFirst.mockResolvedValue(withNotas);
    const anonymous = await partidoRepository.findVisibleById('partido-1', undefined);
    expect(anonymous?.notas).toBeUndefined();
  });

  it('strips notas in the generic detail read', async () => {
    mocks.partidoFindUnique.mockResolvedValue({ ...partido, notas: 'privada' });
    const result = await partidoRepository.findById('partido-1');
    expect(result?.notas).toBeUndefined();
  });
});
