import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findVisibleById: vi.fn(),
  findVisibleByDivision: vi.fn(),
  divisionFindFirst: vi.fn(),
  divisionFindUnique: vi.fn(),
  transaction: vi.fn(),
  roundCreateManyAndReturn: vi.fn(),
  roundFindUnique: vi.fn(),
  partidoCreateMany: vi.fn(),
  partidoFindMany: vi.fn(),
  partidoUpdate: vi.fn(),
}));

vi.mock('./repository', () => ({ rondaPlayoffRepository: mocks }));
vi.mock('../../config/database', () => ({
  prisma: {
    division: { findFirst: mocks.divisionFindFirst, findUnique: mocks.divisionFindUnique },
    $transaction: mocks.transaction,
  },
}));

import { rondaPlayoffService } from './service';
import type { AuthenticatedUser } from '../../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };

describe('rondaPlayoffService public reads', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gets visible detail in one repository operation and preserves its shape', async () => {
    const ronda = { id: 'ronda-1', orden: 1, divisionId: 'division-1' };
    mocks.findVisibleById.mockResolvedValue(ronda);

    await expect(rondaPlayoffService.getById('ronda-1', owner)).resolves.toBe(ronda);
    expect(mocks.findVisibleById).toHaveBeenCalledTimes(1);
    expect(mocks.findVisibleById).toHaveBeenCalledWith('ronda-1', owner);
  });

  it('returns 404 for a hidden or missing round', async () => {
    mocks.findVisibleById.mockResolvedValue(null);
    await expect(rondaPlayoffService.getById('ronda-1')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Ronda de playoff no encontrado',
    });
  });

  it('returns an empty list for a visible division in one repository operation', async () => {
    mocks.findVisibleByDivision.mockResolvedValue([]);
    await expect(rondaPlayoffService.findByDivision('division-1', owner)).resolves.toEqual([]);
    expect(mocks.findVisibleByDivision).toHaveBeenCalledTimes(1);
    expect(mocks.findVisibleByDivision).toHaveBeenCalledWith('division-1', owner);
  });

  it('returns 404 for a hidden or missing division', async () => {
    mocks.findVisibleByDivision.mockResolvedValue(null);
    await expect(rondaPlayoffService.findByDivision('division-1')).rejects.toMatchObject({
      statusCode: 404,
      message: 'División no encontrado',
    });
  });
});

describe('rondaPlayoffService batch writes', () => {
  const tx = {
    rondaPlayoff: {
      createManyAndReturn: mocks.roundCreateManyAndReturn,
      findUnique: mocks.roundFindUnique,
    },
    partido: {
      createMany: mocks.partidoCreateMany,
      findMany: mocks.partidoFindMany,
      update: mocks.partidoUpdate,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.divisionFindUnique.mockResolvedValue({ liga: { userId: owner.id } });
    mocks.divisionFindFirst.mockResolvedValue({
      equipos: Array.from({ length: 8 }, (_, index) => assignedTeam(`team-${index + 1}`, `Team ${index + 1}`)),
    });
    mocks.transaction.mockImplementation((callback) => callback(tx));
    mocks.partidoCreateMany.mockResolvedValue({ count: 0 });
    mocks.partidoUpdate.mockResolvedValue({});
  });

  it('generates all rounds and first-round matches atomically within a four-query budget', async () => {
    mocks.roundCreateManyAndReturn.mockResolvedValue([
      { id: 'final', nombre: 'Final', orden: 3, divisionId: 'division-1' },
      { id: 'quarters', nombre: 'Cuartos', orden: 1, divisionId: 'division-1' },
      { id: 'semis', nombre: 'Semifinal', orden: 2, divisionId: 'division-1' },
    ]);

    const result = await rondaPlayoffService.generate('division-1', 8, owner);

    expect(result.map((round) => round.id)).toEqual(['quarters', 'semis', 'final']);
    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.divisionFindUnique).not.toHaveBeenCalled();
    expect(mocks.divisionFindFirst).toHaveBeenCalledWith({
      where: { id: 'division-1', liga: { userId: owner.id } },
      select: {
        equipos: {
          select: {
            equipoId: true,
            equipo: {
              select: {
                nombre: true,
                tablaPosiciones: {
                  where: { divisionId: 'division-1' },
                  select: { puntos: true, diferenciaGoles: true, ganados: true, golesFavor: true },
                },
              },
            },
          },
        },
      },
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.roundCreateManyAndReturn).toHaveBeenCalledTimes(1);
    expect(mocks.partidoCreateMany).toHaveBeenCalledTimes(1);
    expect(mocks.partidoCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ llave: 1, equipoLocalId: 'team-1', equipoVisitanteId: 'team-8', rondaPlayoffId: 'quarters' }),
        expect.objectContaining({ llave: 2, equipoLocalId: 'team-2', equipoVisitanteId: 'team-7', rondaPlayoffId: 'quarters' }),
        expect.objectContaining({ llave: 3, equipoLocalId: 'team-3', equipoVisitanteId: 'team-6', rondaPlayoffId: 'quarters' }),
        expect.objectContaining({ llave: 4, equipoLocalId: 'team-4', equipoVisitanteId: 'team-5', rondaPlayoffId: 'quarters' }),
      ],
    });
  });

  it('generates a two-team final', async () => {
    mocks.divisionFindFirst.mockResolvedValue({
      equipos: [assignedTeam('team-2', 'Segundo'), assignedTeam('team-1', 'Primero')],
    });
    mocks.roundCreateManyAndReturn.mockResolvedValue([
      { id: 'final', nombre: 'Final', orden: 1, divisionId: 'division-1' },
    ]);

    await rondaPlayoffService.generate('division-1', 2, owner);

    expect(mocks.roundCreateManyAndReturn).toHaveBeenCalledWith({
      data: [{ nombre: 'Final', orden: 1, divisionId: 'division-1' }],
    });
    expect(mocks.partidoCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ equipoLocalId: 'team-1', equipoVisitanteId: 'team-2', llave: 1, rondaPlayoffId: 'final' })],
    });
  });

  it('generates all five rounds and 16 initial matches for 32 teams', async () => {
    mocks.divisionFindFirst.mockResolvedValue({
      equipos: Array.from({ length: 32 }, (_, index) => assignedTeam(`team-${String(index + 1).padStart(2, '0')}`, `Team ${String(index + 1).padStart(2, '0')}`, { puntos: 32 - index })),
    });
    mocks.roundCreateManyAndReturn.mockResolvedValue(
      ['Dieciseisavos', 'Octavos', 'Cuartos', 'Semifinal', 'Final'].map((nombre, index) => ({
        id: `round-${index + 1}`, nombre, orden: index + 1, divisionId: 'division-1',
      })),
    );

    await rondaPlayoffService.generate('division-1', 32, owner);

    expect(mocks.roundCreateManyAndReturn).toHaveBeenCalledWith({
      data: ['Dieciseisavos', 'Octavos', 'Cuartos', 'Semifinal', 'Final'].map((nombre, index) => ({
        nombre, orden: index + 1, divisionId: 'division-1',
      })),
    });
    const matches = mocks.partidoCreateMany.mock.calls[0][0].data;
    expect(matches).toHaveLength(16);
    expect(matches[0]).toMatchObject({ equipoLocalId: 'team-01', equipoVisitanteId: 'team-32', llave: 1, rondaPlayoffId: 'round-1' });
    expect(matches[15]).toMatchObject({ equipoLocalId: 'team-16', equipoVisitanteId: 'team-17', llave: 16 });
  });

  it('uses zero defaults for assigned teams without standings', async () => {
    mocks.divisionFindFirst.mockResolvedValue({
      equipos: [assignedTeam('team-b', 'Beta', { puntos: 0 }), assignedTeam('team-a', 'Alfa')],
    });
    mocks.roundCreateManyAndReturn.mockResolvedValue([
      { id: 'final', nombre: 'Final', orden: 1, divisionId: 'division-1' },
    ]);

    await rondaPlayoffService.generate('division-1', 2, owner);

    expect(mocks.partidoCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ equipoLocalId: 'team-a', equipoVisitanteId: 'team-b' })],
    });
  });

  it('ranks mixed standings by every statistic before pairing first versus last', async () => {
    mocks.divisionFindFirst.mockResolvedValue({ equipos: [
      assignedTeam('team-1', 'Zulu', { puntos: 10, diferenciaGoles: 5, ganados: 3, golesFavor: 10 }),
      assignedTeam('team-2', 'Alfa', { puntos: 10, diferenciaGoles: 5, ganados: 3, golesFavor: 11 }),
      assignedTeam('team-3', 'Beta', { puntos: 10, diferenciaGoles: 6, ganados: 1, golesFavor: 2 }),
      assignedTeam('team-4', 'Celta', { puntos: 11, diferenciaGoles: 0, ganados: 0, golesFavor: 0 }),
    ] });
    mocks.roundCreateManyAndReturn.mockResolvedValue([
      { id: 'semis', nombre: 'Semifinal', orden: 1, divisionId: 'division-1' },
      { id: 'final', nombre: 'Final', orden: 2, divisionId: 'division-1' },
    ]);

    await rondaPlayoffService.generate('division-1', 4, owner);

    expect(mocks.partidoCreateMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ equipoLocalId: 'team-4', equipoVisitanteId: 'team-1' }),
      expect.objectContaining({ equipoLocalId: 'team-3', equipoVisitanteId: 'team-2' }),
    ]);
  });

  it('breaks full statistical ties by Spanish base name and then team id', async () => {
    mocks.divisionFindFirst.mockResolvedValue({ equipos: [
      assignedTeam('team-z', 'Zeta'),
      assignedTeam('team-b', 'Águila'),
      assignedTeam('team-a', 'aguila'),
      assignedTeam('team-c', 'Beta'),
    ] });
    mocks.roundCreateManyAndReturn.mockResolvedValue([
      { id: 'semis', nombre: 'Semifinal', orden: 1, divisionId: 'division-1' },
      { id: 'final', nombre: 'Final', orden: 2, divisionId: 'division-1' },
    ]);

    await rondaPlayoffService.generate('division-1', 4, owner);

    expect(mocks.partidoCreateMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ equipoLocalId: 'team-a', equipoVisitanteId: 'team-z' }),
      expect.objectContaining({ equipoLocalId: 'team-b', equipoVisitanteId: 'team-c' }),
    ]);
  });

  it.each([1, 3, 6, 64])('rejects unsupported team count %i', async (cantidadEquipos) => {
    await expect(rondaPlayoffService.generate('division-1', cantidadEquipos, owner)).rejects.toMatchObject({
      statusCode: 422,
      message: 'La cantidad debe ser 2, 4, 8, 16 o 32',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a bracket larger than the assigned team set', async () => {
    mocks.divisionFindFirst.mockResolvedValue({ equipos: [assignedTeam('team-1', 'Alfa')] });

    await expect(rondaPlayoffService.generate('division-1', 2, owner)).rejects.toMatchObject({
      statusCode: 422,
      message: 'Se necesitan al menos 2 equipos asignados a la división',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('uses the same not-found response for missing and unauthorized divisions', async () => {
    mocks.divisionFindFirst.mockResolvedValue(null);

    await expect(rondaPlayoffService.generate('division-1', 2, owner)).rejects.toMatchObject({
      statusCode: 404,
      message: 'División no encontrado',
    });
    expect(mocks.divisionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'division-1', liga: { userId: owner.id } },
    }));
  });

  it('propagates a first-round insert failure so the transaction rolls back its round insert', async () => {
    mocks.divisionFindFirst.mockResolvedValue({
      equipos: Array.from({ length: 4 }, (_, index) => assignedTeam(`team-${index + 1}`, `Team ${index + 1}`)),
    });
    mocks.roundCreateManyAndReturn.mockResolvedValue([
      { id: 'semis', nombre: 'Semifinal', orden: 1, divisionId: 'division-1' },
      { id: 'final', nombre: 'Final', orden: 2, divisionId: 'division-1' },
    ]);
    mocks.partidoCreateMany.mockRejectedValue(new Error('match insert failed'));

    await expect(rondaPlayoffService.generate('division-1', 4, owner)).rejects.toThrow('match insert failed');
    expect(mocks.roundCreateManyAndReturn).toHaveBeenCalledTimes(1);
    expect(mocks.partidoCreateMany).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it('advances winners with two reads, one batched insert, and concurrent existing-match updates', async () => {
    mocks.roundFindUnique.mockResolvedValue({
      orden: 1,
      division: { rondasPlayoff: [{ id: 'current', orden: 1 }, { id: 'next', orden: 2 }] },
    });
    mocks.partidoFindMany.mockResolvedValue([
      finishedMatch('a', 'current', 1, 'team-1', 'team-8', 2, 0),
      finishedMatch('b', 'current', 2, 'team-2', 'team-7', 0, 1),
      finishedMatch('c', 'current', 3, 'team-3', 'team-6', 1, 0),
      finishedMatch('d', 'current', 4, 'team-4', 'team-5', 0, 2),
      { id: 'existing', rondaPlayoffId: 'next', llave: 1 },
    ]);

    await rondaPlayoffService.advanceWinners('current');

    expect(mocks.roundFindUnique).toHaveBeenCalledTimes(1);
    expect(mocks.partidoFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.partidoCreateMany).toHaveBeenCalledTimes(1);
    expect(mocks.partidoCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ llave: 2, equipoLocalId: 'team-3', equipoVisitanteId: 'team-5' })],
    });
    expect(mocks.partidoUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.partidoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'existing' },
      data: expect.objectContaining({ equipoLocalId: 'team-1', equipoVisitanteId: 'team-7', estado: 'PROGRAMADO' }),
    }));
  });

  it('propagates an advancement update failure from the transaction for atomic rollback', async () => {
    mocks.roundFindUnique.mockResolvedValue({
      orden: 1,
      division: { rondasPlayoff: [{ id: 'current', orden: 1 }, { id: 'next', orden: 2 }] },
    });
    mocks.partidoFindMany.mockResolvedValue([
      finishedMatch('a', 'current', 1, 'team-1', 'team-4', 2, 0),
      finishedMatch('b', 'current', 2, 'team-2', 'team-3', 0, 1),
      { id: 'existing', rondaPlayoffId: 'next', llave: 1 },
    ]);
    mocks.partidoUpdate.mockRejectedValue(new Error('advance update failed'));

    await expect(rondaPlayoffService.advanceWinners('current')).rejects.toThrow('advance update failed');
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.partidoUpdate).toHaveBeenCalledTimes(1);
  });
});

function assignedTeam(
  equipoId: string,
  nombre: string,
  stats?: Partial<{ puntos: number; diferenciaGoles: number; ganados: number; golesFavor: number }>,
) {
  return {
    equipoId,
    equipo: {
      nombre,
      tablaPosiciones: stats ? [{ puntos: 0, diferenciaGoles: 0, ganados: 0, golesFavor: 0, ...stats }] : [],
    },
  };
}

function finishedMatch(
  id: string,
  rondaPlayoffId: string,
  llave: number,
  equipoLocalId: string,
  equipoVisitanteId: string,
  golesLocal: number,
  golesVisitante: number,
) {
  return {
    id,
    rondaPlayoffId,
    llave,
    equipoLocalId,
    equipoVisitanteId,
    estado: 'FINALIZADO',
    golesLocal,
    golesVisitante,
    penalesLocal: null,
    penalesVisitante: null,
  };
}
