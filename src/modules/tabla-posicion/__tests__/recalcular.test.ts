import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  transaction: vi.fn(),
  teamsFindMany: vi.fn(),
  matchesFindMany: vi.fn(),
  standingsDeleteMany: vi.fn(),
  standingsCreateMany: vi.fn(),
}));

vi.mock('../../../config/database', () => ({
  prisma: {
    $transaction: db.transaction,
    divisionEquipo: { findMany: db.teamsFindMany },
    partido: { findMany: db.matchesFindMany },
  },
}));

import { prisma } from '../../../config/database';
import { tablaPosicionService } from '../service';

const divisionId = 'division-1';

function mockTeams() {
  vi.mocked(prisma.divisionEquipo.findMany).mockResolvedValue([
    { equipoId: 'local' },
    { equipoId: 'visitante' },
  ] as never);
}

function mockTiedMatch(penalesLocal: number, penalesVisitante: number) {
  vi.mocked(prisma.partido.findMany).mockResolvedValue([
    {
      equipoLocalId: 'local',
      equipoVisitanteId: 'visitante',
      golesLocal: 2,
      golesVisitante: 2,
      penalesLocal,
      penalesVisitante,
      tipoPartido: 'REGULAR',
    },
  ] as never);
}

function createdRow(equipoId: string) {
  const data = db.standingsCreateMany.mock.calls[0]?.[0].data;
  return data.find((row: { equipoId: string }) => row.equipoId === equipoId);
}

describe('tablaPosicionService.recalcular', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.transaction.mockImplementation(async (callback) => callback({
      divisionEquipo: { findMany: db.teamsFindMany },
      partido: { findMany: db.matchesFindMany },
      tablaPosicion: {
        deleteMany: db.standingsDeleteMany,
        createMany: db.standingsCreateMany,
      },
    }));
    mockTeams();
  });

  it('registra empate para ambos y 2/1 puntos cuando gana el local por penales', async () => {
    mockTiedMatch(5, 4);

    await tablaPosicionService.recalcular(divisionId);

    expect(createdRow('local')).toMatchObject({
      partidosJugados: 1,
      ganados: 0,
      empatados: 1,
      perdidos: 0,
      golesFavor: 2,
      golesContra: 2,
      diferenciaGoles: 0,
      puntos: 2,
    });
    expect(createdRow('visitante')).toMatchObject({
      partidosJugados: 1,
      ganados: 0,
      empatados: 1,
      perdidos: 0,
      golesFavor: 2,
      golesContra: 2,
      diferenciaGoles: 0,
      puntos: 1,
    });
  });

  it('registra empate para ambos y 2/1 puntos cuando gana el visitante por penales', async () => {
    mockTiedMatch(3, 4);

    await tablaPosicionService.recalcular(divisionId);

    expect(createdRow('local')).toMatchObject({
      ganados: 0,
      empatados: 1,
      perdidos: 0,
      puntos: 1,
    });
    expect(createdRow('visitante')).toMatchObject({
      ganados: 0,
      empatados: 1,
      perdidos: 0,
      puntos: 2,
    });
  });

  it('no registra estadísticas para ningún equipo en partido amistoso (local gana)', async () => {
    vi.mocked(prisma.partido.findMany).mockResolvedValue([
      {
        equipoLocalId: 'local',
        equipoVisitanteId: 'visitante',
        golesLocal: 3,
        golesVisitante: 1,
        penalesLocal: null,
        penalesVisitante: null,
        tipoPartido: 'AMISTOSO',
      },
    ] as never);

    await tablaPosicionService.recalcular(divisionId);

    expect(createdRow('local')).toMatchObject({
      partidosJugados: 0, ganados: 0, empatados: 0, perdidos: 0,
      golesFavor: 0, golesContra: 0, diferenciaGoles: 0, puntos: 0,
    });
    expect(createdRow('visitante')).toMatchObject({
      partidosJugados: 0, ganados: 0, empatados: 0, perdidos: 0,
      golesFavor: 0, golesContra: 0, diferenciaGoles: 0, puntos: 0,
    });
  });

  it('no registra estadísticas para ningún equipo en partido amistoso (empate con penales)', async () => {
    vi.mocked(prisma.partido.findMany).mockResolvedValue([
      {
        equipoLocalId: 'local',
        equipoVisitanteId: 'visitante',
        golesLocal: 1,
        golesVisitante: 1,
        penalesLocal: 4,
        penalesVisitante: 3,
        tipoPartido: 'AMISTOSO',
      },
    ] as never);

    await tablaPosicionService.recalcular(divisionId);

    expect(createdRow('local')).toMatchObject({
      partidosJugados: 0, ganados: 0, empatados: 0, perdidos: 0,
      golesFavor: 0, golesContra: 0, diferenciaGoles: 0, puntos: 0,
    });
    expect(createdRow('visitante')).toMatchObject({
      partidosJugados: 0, ganados: 0, empatados: 0, perdidos: 0,
      golesFavor: 0, golesContra: 0, diferenciaGoles: 0, puntos: 0,
    });
  });

  it('reemplaza toda la tabla con deleteMany y createMany dentro de una sola transacción', async () => {
    mockTiedMatch(5, 4);

    await tablaPosicionService.recalcular(divisionId);

    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' });
    expect(db.standingsDeleteMany).toHaveBeenCalledWith({ where: { divisionId } });
    expect(db.standingsCreateMany).toHaveBeenCalledOnce();
    expect(db.standingsCreateMany.mock.invocationCallOrder[0])
      .toBeGreaterThan(db.standingsDeleteMany.mock.invocationCallOrder[0]);
    expect(db.teamsFindMany.mock.invocationCallOrder[0])
      .toBeGreaterThan(db.transaction.mock.invocationCallOrder[0]);
  });

  it('usa directamente el cliente transaccional recibido sin abrir otra transacción', async () => {
    mockTiedMatch(5, 4);
    const tx = {
      divisionEquipo: { findMany: db.teamsFindMany },
      partido: { findMany: db.matchesFindMany },
      tablaPosicion: { deleteMany: db.standingsDeleteMany, createMany: db.standingsCreateMany },
    } as any;

    await tablaPosicionService.recalcular(divisionId, tx);

    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.teamsFindMany).toHaveBeenCalledOnce();
    expect(db.matchesFindMany).toHaveBeenCalledOnce();
    expect(db.standingsDeleteMany).toHaveBeenCalledOnce();
    expect(db.standingsCreateMany).toHaveBeenCalledOnce();
  });

  it('mantiene un presupuesto constante de consultas aunque aumente el número de equipos', async () => {
    db.teamsFindMany.mockResolvedValue(
      Array.from({ length: 100 }, (_, index) => ({ equipoId: `team-${index}` })),
    );
    db.matchesFindMany.mockResolvedValue([]);

    await tablaPosicionService.recalcular(divisionId);

    expect(db.teamsFindMany).toHaveBeenCalledOnce();
    expect(db.teamsFindMany).toHaveBeenCalledWith({
      where: { divisionId },
      select: { equipoId: true },
    });
    expect(db.matchesFindMany).toHaveBeenCalledOnce();
    expect(db.matchesFindMany).toHaveBeenCalledWith({
      where: {
        jornada: { divisionId },
        estado: 'FINALIZADO',
        rondaPlayoffId: null,
      },
      select: {
        equipoLocalId: true,
        equipoVisitanteId: true,
        golesLocal: true,
        golesVisitante: true,
        penalesLocal: true,
        penalesVisitante: true,
        tipoPartido: true,
      },
    });
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.standingsDeleteMany).toHaveBeenCalledOnce();
    expect(db.standingsCreateMany).toHaveBeenCalledOnce();
    expect(db.standingsCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ equipoId: 'team-0' }),
        expect.objectContaining({ equipoId: 'team-99' }),
      ]),
    });
    expect(db.standingsCreateMany.mock.calls[0][0].data).toHaveLength(100);
  });
});
