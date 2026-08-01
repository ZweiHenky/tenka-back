import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  jornadaFindFirst: vi.fn(),
  jornadaFindMany: vi.fn(),
  jornadaCount: vi.fn(),
  divisionFindFirst: vi.fn(),
}));

vi.mock('../../../config/database', () => ({
  prisma: {
    jornada: {
      findFirst: mocks.jornadaFindFirst,
      findMany: mocks.jornadaFindMany,
      count: mocks.jornadaCount,
    },
    division: { findFirst: mocks.divisionFindFirst },
  },
}));

import { jornadaRepository } from '../repository';

const partido = {
  id: 'p-1',
  arbitros: [{ arbitro: { id: 'a-1', nombre: 'Arbitro Uno' } }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('jornadaRepository public reads', () => {
  it('loads visible detail and its full partido payload in one Prisma operation', async () => {
    mocks.jornadaFindFirst.mockResolvedValue({ id: 'j-1', divisionId: 'd-1', partidos: [partido] });

    const result = await jornadaRepository.findVisibleById('j-1');

    expect(mocks.jornadaFindFirst).toHaveBeenCalledOnce();
    expect(mocks.jornadaFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'j-1',
        division: { estadoLiga: { nombre: { not: 'Borrador' } } },
      },
      include: {
        partidos: {
          orderBy: { fecha: 'asc' },
          include: {
            equipoLocal: { select: { id: true, nombre: true, logo: true } },
            equipoVisitante: { select: { id: true, nombre: true, logo: true } },
            cancha: { select: { id: true, nombre: true } },
            arbitros: { include: { arbitro: { select: { id: true, nombre: true } } } },
          },
        },
      },
    });
    expect(result?.partidos?.[0]).toMatchObject({
      id: 'p-1',
      arbitros: [{ id: 'a-1', nombre: 'Arbitro Uno' }],
    });
    expect(mocks.divisionFindFirst).not.toHaveBeenCalled();
  });

  it('selects paginated jornadas and total from one visible parent operation', async () => {
    mocks.divisionFindFirst.mockResolvedValue({
      jornadas: [{ id: 'j-2', divisionId: 'd-1', partidos: [partido] }],
      _count: { jornadas: 7 },
    });

    const result = await jornadaRepository.findVisibleByDivision('d-1', { skip: 10, take: 10 });

    expect(mocks.divisionFindFirst).toHaveBeenCalledOnce();
    expect(mocks.divisionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'd-1',
        estadoLiga: { nombre: { not: 'Borrador' } },
      },
      select: expect.objectContaining({
        jornadas: expect.objectContaining({
          orderBy: { numero: 'desc' },
          skip: 10,
          take: 10,
        }),
        _count: { select: { jornadas: true } },
      }),
    }));
    expect(result).toEqual({
      rows: [{ id: 'j-2', divisionId: 'd-1', partidos: [{ id: 'p-1', arbitros: [{ id: 'a-1', nombre: 'Arbitro Uno' }] }] }],
      total: 7,
    });
    expect(mocks.jornadaFindMany).not.toHaveBeenCalled();
    expect(mocks.jornadaCount).not.toHaveBeenCalled();
    expect(mocks.jornadaFindFirst).not.toHaveBeenCalled();
  });
});
