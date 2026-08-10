import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ ligaFindFirst: vi.fn(), partidoFindMany: vi.fn() }));
vi.mock('../../config/database', () => ({
  prisma: {
    liga: { findFirst: mocks.ligaFindFirst },
    partido: { findMany: mocks.partidoFindMany },
  },
}));

import { disponibilidadCanchaRepository } from './repository';
import type { AuthenticatedUser } from '../../types/auth';

const owner: AuthenticatedUser = { id: 'owner', email: 'owner@test.com', rol: 'LIGA' };
const admin: AuthenticatedUser = { id: 'admin', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
const inicio = new Date('2026-08-01T00:00:00.000Z');
const fin = new Date('2026-08-02T00:00:00.000Z');

describe('disponibilidadCanchaRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['owner', owner, { id: 'liga-1', userId: 'owner' }],
    ['admin', admin, { id: 'liga-1' }],
  ])('loads only active courts with %s authorization in one narrow query', async (_label, actor, where) => {
    mocks.ligaFindFirst.mockResolvedValue(null);
    await disponibilidadCanchaRepository.findLeagueContext('liga-1', actor);

    expect(mocks.ligaFindFirst).toHaveBeenCalledWith({
      where,
      select: {
        id: true,
        multiplesCanchas: true,
        canchas: {
          where: { activa: true },
          orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
          select: { id: true, nombre: true },
        },
      },
    });
  });

  it('queries half-open occupancy through jornada and playoff divisions and projects context', async () => {
    mocks.partidoFindMany.mockResolvedValue([
      { id: 'regular', fecha: inicio, fechaFin: fin, canchaId: 'a', jornada: { division: { id: 'd1', nombre: 'Uno' } }, rondaPlayoff: null },
      { id: 'playoff', fecha: inicio, fechaFin: fin, canchaId: null, jornada: null, rondaPlayoff: { division: { id: 'd2', nombre: 'Dos' } } },
    ]);

    const result = await disponibilidadCanchaRepository.findOccupancy('liga-1', inicio, fin);

    expect(mocks.partidoFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        fecha: { lt: fin },
        fechaFin: { gt: inicio },
        OR: [
          { jornada: { division: { ligaId: 'liga-1' } } },
          { rondaPlayoff: { division: { ligaId: 'liga-1' } } },
        ],
      },
      select: expect.objectContaining({ id: true, fecha: true, fechaFin: true, canchaId: true }),
    }));
    expect(result.map(({ id, division }) => [id, division.id])).toEqual([['regular', 'd1'], ['playoff', 'd2']]);
  });
});
