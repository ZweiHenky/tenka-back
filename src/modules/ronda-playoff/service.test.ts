import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findVisibleById: vi.fn(),
  findVisibleByDivision: vi.fn(),
  divisionFindFirst: vi.fn(),
  divisionFindUnique: vi.fn(),
  transaction: vi.fn(),
  roundCreateManyAndReturn: vi.fn(),
  roundFindUnique: vi.fn(),
  roundDelete: vi.fn(),
  roundDeleteMany: vi.fn(),
  partidoCreateMany: vi.fn(),
  partidoFindMany: vi.fn(),
  partidoCreate: vi.fn(),
  partidoDelete: vi.fn(),
  partidoUpdate: vi.fn(),
  anotacionDeleteMany: vi.fn(),
  jornadaDeleteMany: vi.fn(),
  campeonUpdateMany: vi.fn(),
  participacionDeleteMany: vi.fn(),
  executeRaw: vi.fn(),
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
    $executeRawUnsafe: mocks.executeRaw,
    division: {
      findUnique: mocks.divisionFindUnique,
      findFirst: async (...args: any[]) => {
        const division = await mocks.divisionFindFirst(...args);
        return division ? { ligaId: 'league-1', ...division } : division;
      },
    },
    rondaPlayoff: {
      createManyAndReturn: mocks.roundCreateManyAndReturn,
      findUnique: mocks.roundFindUnique,
      delete: mocks.roundDelete,
      deleteMany: mocks.roundDeleteMany,
    },
    partido: {
      createMany: mocks.partidoCreateMany,
      create: mocks.partidoCreate,
      delete: mocks.partidoDelete,
      findMany: mocks.partidoFindMany,
      update: mocks.partidoUpdate,
    },
    jornada: { deleteMany: mocks.jornadaDeleteMany },
    divisionCampeon: { updateMany: mocks.campeonUpdateMany },
    anotacionPartido: { deleteMany: mocks.anotacionDeleteMany },
    participacionPartido: { deleteMany: mocks.participacionDeleteMany },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.divisionFindUnique.mockResolvedValue({ ligaId: 'league-1', liga: { userId: owner.id } });
    mocks.divisionFindFirst.mockResolvedValue({
      rondasPlayoff: [],
      equipos: Array.from({ length: 8 }, (_, index) => assignedTeam(`team-${index + 1}`, `Team ${index + 1}`)),
    });
    mocks.transaction.mockImplementation((callback) => callback(tx));
    mocks.partidoCreateMany.mockResolvedValue({ count: 0 });
    mocks.partidoCreate.mockResolvedValue({});
    mocks.partidoDelete.mockResolvedValue({});
    mocks.partidoUpdate.mockResolvedValue({});
    mocks.roundDelete.mockResolvedValue({});
    mocks.roundDeleteMany.mockResolvedValue({ count: 0 });
    mocks.jornadaDeleteMany.mockResolvedValue({ count: 0 });
    mocks.campeonUpdateMany.mockResolvedValue({ count: 0 });
    mocks.executeRaw.mockResolvedValue(0);
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
    expect(mocks.divisionFindUnique).toHaveBeenCalledWith({ where: { id: 'division-1' }, select: { ligaId: true } });
    expect(mocks.divisionFindFirst).toHaveBeenCalledWith({
      where: { id: 'division-1', liga: { userId: owner.id } },
      select: {
        ligaId: true,
        estadoLiga: { select: { codigo: true } },
        rondasPlayoff: { take: 1, select: { id: true } },
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

  // La siembra por posiciones es el default y no debe cambiar: un cliente viejo que no manda
  // `siembra` tiene que seguir generando exactamente el mismo cuadro que antes.
  describe('estrategias de siembra', () => {
    beforeEach(() => {
      mocks.roundCreateManyAndReturn.mockResolvedValue([
        { id: 'semis', nombre: 'Semifinal', orden: 1, divisionId: 'division-1' },
        { id: 'final', nombre: 'Final', orden: 2, divisionId: 'division-1' },
      ])
      mocks.divisionFindFirst.mockResolvedValue({
        rondasPlayoff: [],
        equipos: Array.from({ length: 4 }, (_, index) => assignedTeam(`team-${index + 1}`, `Team ${index + 1}`)),
      })
    })

    const llavesCreadas = () => mocks.partidoCreateMany.mock.calls[0][0].data
      .map((partido: any) => [partido.equipoLocalId, partido.equipoVisitanteId])

    it('sortea con el generador inyectado y empareja consecutivos', async () => {
      // Fisher-Yates con random fijo en 0: cada vuelta manda el actual al frente.
      await rondaPlayoffService.generate('division-1', 4, owner, { siembra: 'ALEATORIA', random: () => 0 })

      const llaves = llavesCreadas()
      expect(llaves).toHaveLength(2)
      expect(new Set(llaves.flat()).size).toBe(4)
      expect(llaves).toEqual([['team-2', 'team-3'], ['team-4', 'team-1']])
    })

    it('respeta las llaves manuales tal cual llegan', async () => {
      await rondaPlayoffService.generate('division-1', 4, owner, {
        siembra: 'MANUAL',
        llaves: [
          { equipoLocalId: 'team-3', equipoVisitanteId: 'team-1' },
          { equipoLocalId: 'team-2', equipoVisitanteId: 'team-4' },
        ],
      })

      expect(llavesCreadas()).toEqual([['team-3', 'team-1'], ['team-2', 'team-4']])
    })

    it('rechaza un equipo que no está asignado a la división', async () => {
      await expect(rondaPlayoffService.generate('division-1', 4, owner, {
        siembra: 'MANUAL',
        llaves: [
          { equipoLocalId: 'team-1', equipoVisitanteId: 'ajeno' },
          { equipoLocalId: 'team-2', equipoVisitanteId: 'team-3' },
        ],
      })).rejects.toMatchObject({ statusCode: 422, message: 'El equipo de la llave #1 no está asignado a esta división' })
      expect(mocks.partidoCreateMany).not.toHaveBeenCalled()
    })

    it('rechaza un equipo repetido y dice en qué llaves está', async () => {
      await expect(rondaPlayoffService.generate('division-1', 4, owner, {
        siembra: 'MANUAL',
        llaves: [
          { equipoLocalId: 'team-1', equipoVisitanteId: 'team-2' },
          { equipoLocalId: 'team-1', equipoVisitanteId: 'team-3' },
        ],
      })).rejects.toMatchObject({ statusCode: 422, message: 'El equipo "Team 1" aparece en las llaves #1 y #2' })
      expect(mocks.partidoCreateMany).not.toHaveBeenCalled()
    })

    it('rechaza una llave contra sí mismo', async () => {
      await expect(rondaPlayoffService.generate('division-1', 4, owner, {
        siembra: 'MANUAL',
        llaves: [
          { equipoLocalId: 'team-1', equipoVisitanteId: 'team-1' },
          { equipoLocalId: 'team-2', equipoVisitanteId: 'team-3' },
        ],
      })).rejects.toMatchObject({ statusCode: 422, message: 'La llave #1 enfrenta a un equipo consigo mismo' })
    })

    it('rechaza siembra manual sin llaves antes de abrir la transacción', async () => {
      await expect(rondaPlayoffService.generate('division-1', 4, owner, { siembra: 'MANUAL' }))
        .rejects.toMatchObject({ statusCode: 422, message: 'La siembra manual necesita las llaves' })
      expect(mocks.transaction).not.toHaveBeenCalled()
    })

    it('sin tabla de posiciones siembra alfabéticamente, que es el cuadro puro', async () => {
      mocks.divisionFindFirst.mockResolvedValue({
        rondasPlayoff: [],
        equipos: [
          { equipoId: 'z', equipo: { nombre: 'Zorros', tablaPosiciones: [] } },
          { equipoId: 'a', equipo: { nombre: 'Águilas', tablaPosiciones: [] } },
          { equipoId: 'm', equipo: { nombre: 'Muros', tablaPosiciones: [] } },
          { equipoId: 'c', equipo: { nombre: 'Cuervos', tablaPosiciones: [] } },
        ],
      })

      await rondaPlayoffService.generate('division-1', 4, owner)

      expect(llavesCreadas()).toEqual([['a', 'z'], ['c', 'm']])
    })
  })

  it('generates a two-team final', async () => {
    mocks.divisionFindFirst.mockResolvedValue({
      rondasPlayoff: [], equipos: [assignedTeam('team-2', 'Segundo'), assignedTeam('team-1', 'Primero')],
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
      rondasPlayoff: [], equipos: Array.from({ length: 32 }, (_, index) => assignedTeam(`team-${String(index + 1).padStart(2, '0')}`, `Team ${String(index + 1).padStart(2, '0')}`, { puntos: 32 - index })),
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
      rondasPlayoff: [], equipos: [assignedTeam('team-b', 'Beta', { puntos: 0 }), assignedTeam('team-a', 'Alfa')],
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
    mocks.divisionFindFirst.mockResolvedValue({ rondasPlayoff: [], equipos: [
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
    mocks.divisionFindFirst.mockResolvedValue({ rondasPlayoff: [], equipos: [
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
    mocks.divisionFindFirst.mockResolvedValue({ rondasPlayoff: [], equipos: [assignedTeam('team-1', 'Alfa')] });

    await expect(rondaPlayoffService.generate('division-1', 2, owner)).rejects.toMatchObject({
      statusCode: 422,
      message: 'Se necesitan al menos 2 equipos asignados a la división',
    });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
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
      rondasPlayoff: [], equipos: Array.from({ length: 4 }, (_, index) => assignedTeam(`team-${index + 1}`, `Team ${index + 1}`)),
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

  it('rejects duplicate bracket generation after rereading rounds under the league lock', async () => {
    mocks.divisionFindFirst.mockResolvedValue({ rondasPlayoff: [{ id: 'existing' }], equipos: [] });

    await expect(rondaPlayoffService.generate('division-1', 2, owner)).rejects.toMatchObject({
      statusCode: 409,
      message: 'La división ya tiene rondas de playoff',
    });

    expect(mocks.executeRaw).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', 'league-1');
    expect(mocks.roundCreateManyAndReturn).not.toHaveBeenCalled();
  });

  it('maps a concurrent unique collision during generation to conflict', async () => {
    mocks.divisionFindFirst.mockResolvedValue({
      rondasPlayoff: [],
      equipos: [assignedTeam('team-1', 'Uno'), assignedTeam('team-2', 'Dos')],
    });
    mocks.roundCreateManyAndReturn.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    await expect(rondaPlayoffService.generate('division-1', 2, owner)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('deletes an individual round only when it is the latest round', async () => {
    mocks.roundFindUnique
      .mockResolvedValueOnce({ divisionId: 'division-1', division: { ligaId: 'league-1' } })
      .mockResolvedValueOnce({ orden: 2, division: { ligaId: 'league-1', liga: { userId: owner.id }, rondasPlayoff: [{ id: 'latest' }] } });

    await rondaPlayoffService.delete('latest', owner);

    expect(mocks.roundDelete).toHaveBeenCalledWith({ where: { id: 'latest' } });
    expect(mocks.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.roundDelete.mock.invocationCallOrder[0]);
  });

  // Los partidos del cuadro se van por cascada, pero la jornada que los contenía sobrevive vacía
  // y sigue apareciendo en el horario. En un cuadro puro esa jornada no tenía nada más.
  describe('limpieza de jornadas vacías', () => {
    const jornadasVacias = { where: { divisionId: 'division-1', partidos: { none: {} } } }

    it('borra las jornadas que quedaron sin partidos al borrar las eliminatorias', async () => {
      await rondaPlayoffService.deleteByDivision('division-1', owner)

      expect(mocks.roundDeleteMany).toHaveBeenCalledWith({ where: { divisionId: 'division-1' } })
      expect(mocks.jornadaDeleteMany).toHaveBeenCalledWith(jornadasVacias)
      // Después de las rondas: antes no habría ninguna jornada vacía todavía.
      expect(mocks.roundDeleteMany.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.jornadaDeleteMany.mock.invocationCallOrder[0])
    })

    // Una división de liga solo pierde sus partidos de playoff; su jornada sigue teniendo los
    // regulares y no debe tocarse.
    it('el filtro exige que la jornada no tenga ningún partido', async () => {
      await rondaPlayoffService.deleteByDivision('division-1', owner)

      expect(mocks.jornadaDeleteMany.mock.calls[0][0].where.partidos).toEqual({ none: {} })
      expect(mocks.jornadaDeleteMany.mock.calls[0][0].where.divisionId).toBe('division-1')
    })

    it('también limpia al borrar una sola ronda', async () => {
      mocks.roundFindUnique
        .mockResolvedValueOnce({ divisionId: 'division-1', division: { ligaId: 'league-1' } })
        .mockResolvedValueOnce({ orden: 2, division: { ligaId: 'league-1', liga: { userId: owner.id }, rondasPlayoff: [{ id: 'latest' }] } })

      await rondaPlayoffService.delete('latest', owner)

      expect(mocks.jornadaDeleteMany).toHaveBeenCalledWith(jornadasVacias)
    })
  })

  // Un cuadro nuevo es una temporada nueva: ahí se archiva el título anterior. Borrar el cuadro
  // **no** lo toca, para que el dueño lo pueda seguir corrigiendo con "Quitar campeón".
  describe('el título se archiva al empezar otra temporada', () => {
    it('generar un cuadro archiva el campeón vigente', async () => {
      mocks.roundCreateManyAndReturn.mockResolvedValue([
        { id: 'final', nombre: 'Final', orden: 3, divisionId: 'division-1' },
      ])

      await rondaPlayoffService.generate('division-1', 2, owner)

      expect(mocks.campeonUpdateMany).toHaveBeenCalledWith({
        where: { divisionId: 'division-1', archivadoEn: null },
        data: { archivadoEn: expect.any(Date) },
      })
    })

    it('borrar las eliminatorias no toca el campeón', async () => {
      await rondaPlayoffService.deleteByDivision('division-1', owner)

      expect(mocks.campeonUpdateMany).not.toHaveBeenCalled()
    })

    it('borrar la última ronda tampoco lo toca', async () => {
      mocks.roundFindUnique
        .mockResolvedValueOnce({ divisionId: 'division-1', division: { ligaId: 'league-1' } })
        .mockResolvedValueOnce({ orden: 2, division: { ligaId: 'league-1', liga: { userId: owner.id }, rondasPlayoff: [{ id: 'latest' }] } })

      await rondaPlayoffService.delete('latest', owner)

      expect(mocks.campeonUpdateMany).not.toHaveBeenCalled()
    })
  })

  it('rejects deletion of a non-latest round without deleting it', async () => {
    mocks.roundFindUnique
      .mockResolvedValueOnce({ divisionId: 'division-1', division: { ligaId: 'league-1' } })
      .mockResolvedValueOnce({ orden: 1, division: { ligaId: 'league-1', liga: { userId: owner.id }, rondasPlayoff: [{ id: 'latest' }] } });

    await expect(rondaPlayoffService.delete('earlier', owner)).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.roundDelete).not.toHaveBeenCalled();
  });

  it('advances winners with two reads, one batched insert, and concurrent existing-match updates', async () => {
    mocks.roundFindUnique.mockResolvedValue({
      orden: 1,
      division: { ligaId: 'league-1', rondasPlayoff: [{ id: 'current', orden: 1 }, { id: 'next', orden: 2 }] },
    });
    mocks.partidoFindMany.mockResolvedValue([
      finishedMatch('a', 'current', 1, 'team-1', 'team-8', 2, 0),
      finishedMatch('b', 'current', 2, 'team-2', 'team-7', 0, 1),
      finishedMatch('c', 'current', 3, 'team-3', 'team-6', 1, 0),
      finishedMatch('d', 'current', 4, 'team-4', 'team-5', 0, 2),
      { id: 'existing', rondaPlayoffId: 'next', llave: 1 },
    ]);

    await rondaPlayoffService.advanceWinners('current');

    expect(mocks.roundFindUnique).toHaveBeenCalledTimes(2);
    expect(mocks.partidoFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.partidoCreate).toHaveBeenCalledTimes(1);
    expect(mocks.partidoCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ llave: 2, equipoLocalId: 'team-3', equipoVisitanteId: 'team-5' }),
    });
    expect(mocks.partidoUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.partidoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'existing' },
      data: expect.objectContaining({ equipoLocalId: 'team-1', equipoVisitanteId: 'team-7', estado: 'PROGRAMADO' }),
    }));
    expect(mocks.anotacionDeleteMany).toHaveBeenCalledWith({ where: { partidoId: 'existing' } });
    expect(mocks.participacionDeleteMany).toHaveBeenCalledWith({ where: { partidoId: 'existing' } });
  });

  it('propagates an advancement update failure from the transaction for atomic rollback', async () => {
    mocks.roundFindUnique.mockResolvedValue({
      orden: 1,
      division: { ligaId: 'league-1', rondasPlayoff: [{ id: 'current', orden: 1 }, { id: 'next', orden: 2 }] },
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

  it('removes an unattached derived match when its source pair is no longer finalized', async () => {
    mocks.roundFindUnique.mockResolvedValue({
      orden: 1,
      division: { rondasPlayoff: [{ id: 'current', orden: 1 }, { id: 'next', orden: 2 }] },
    });
    mocks.partidoFindMany.mockResolvedValue([
      finishedMatch('a', 'current', 1, 'team-1', 'team-4', 2, 0),
      { ...finishedMatch('b', 'current', 2, 'team-2', 'team-3', 0, 1), estado: 'SUSPENDIDO' },
      { id: 'derived', rondaPlayoffId: 'next', llave: 1, estado: 'PROGRAMADO', jornadaId: null },
    ]);

    await rondaPlayoffService.syncAdvancement(tx as any, 'current');

    expect(mocks.partidoDelete).toHaveBeenCalledWith({ where: { id: 'derived' } });
  });

  it.each([
    { estado: 'FINALIZADO', jornadaId: null },
    { estado: 'PROGRAMADO', jornadaId: 'jornada-1' },
  ])('rejects advancement reversal for protected derived match %#', async (protection) => {
    mocks.roundFindUnique.mockResolvedValue({
      orden: 1,
      division: { rondasPlayoff: [{ id: 'current', orden: 1 }, { id: 'next', orden: 2 }] },
    });
    mocks.partidoFindMany.mockResolvedValue([
      finishedMatch('a', 'current', 1, 'team-1', 'team-4', 2, 0),
      { ...finishedMatch('b', 'current', 2, 'team-2', 'team-3', 0, 1), estado: 'SUSPENDIDO' },
      { id: 'derived', rondaPlayoffId: 'next', llave: 1, ...protection },
    ]);

    await expect(rondaPlayoffService.syncAdvancement(tx as any, 'current')).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.partidoDelete).not.toHaveBeenCalled();
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
