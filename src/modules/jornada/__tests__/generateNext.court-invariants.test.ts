import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  divisionId, jornadaService, mockDivision, mockJornadaCreated,
  mockNoPreviousJornadas, mockTeams, partidoRepository, prisma,
  resetGenerateNextHarness, jornadaRepository,
} from './support/generateNextHarness';

beforeEach(resetGenerateNextHarness);

const slot = {
  fecha: '2099-01-01',
  horaInicio: '18:00',
  horaFin: '19:00',
  equipoLocalId: 't1',
  equipoVisitanteId: 't2',
};

function arrange(multiplesCanchas = false) {
  mockDivision({ duracionPartido: 60, multiplesCanchas });
  mockTeams(['t1', 't2']);
  mockNoPreviousJornadas();
  mockJornadaCreated();
  if (multiplesCanchas) {
    (prisma.ligaCancha.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'c1', nombre: 'Cancha 1', activa: true },
      { id: 'c2', nombre: 'Cancha 2', activa: true },
    ]);
  }
}

describe('generateNext court invariants', () => {
  it('requires horaFin to match the authoritative division duration', async () => {
    arrange();
    await expect(jornadaService.generateNext(divisionId, [{ ...slot, horaFin: '19:30' }]))
      .rejects.toThrow('no coincide con la duración de 60 minutos');
  });

  it('refuses scheduled slots when the division has no authoritative duration', async () => {
    mockDivision({ duracionPartido: null });
    mockTeams(['t1', 't2']);
    mockNoPreviousJornadas();
    await expect(jornadaService.generateNext(divisionId, [slot]))
      .rejects.toThrow('duración de partido válida');
  });

  it('forces the virtual court in SINGLE mode', async () => {
    arrange();
    await expect(jornadaService.generateNext(divisionId, [{ ...slot, canchaId: 'c1' }]))
      .rejects.toThrow('canchaId nulo');
  });

  it('requires an explicit active same-league court in MULTIPLE mode', async () => {
    arrange(true);
    await expect(jornadaService.generateNext(divisionId, [slot]))
      .rejects.toThrow('cancha activa de esta liga');
    await expect(jornadaService.generateNext(divisionId, [{ ...slot, canchaId: 'otra-liga' }]))
      .rejects.toThrow('cancha activa de esta liga');
  });

  it('resuelve y persiste la cancha fija aunque el cliente la omita', async () => {
    arrange(true);
    mockDivision({ duracionPartido: 60, multiplesCanchas: true, canchaUnicaId: 'c1' });

    await jornadaService.generateNext(divisionId, [slot]);

    expect(partidoRepository.create).toHaveBeenCalledWith(expect.objectContaining({ canchaId: 'c1' }));
  });

  it('repite una generación con la misma clave sin crear ni notificar otra jornada', async () => {
    arrange(true);
    await jornadaService.generateNext(divisionId, [{ ...slot, canchaId: 'c1' }], 'same-generation-key');
    const createData = ((jornadaRepository as any).create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createData).toEqual(expect.objectContaining({
      generationKey: 'same-generation-key',
      generationRequestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));

    (prisma.$transaction as ReturnType<typeof vi.fn>).mockClear();
    (prisma.notificationOutbox.createMany as ReturnType<typeof vi.fn>).mockClear();
    (prisma.jornada.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...createData,
      id: 'j-new-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const replay = await jornadaService.generateNext(divisionId, [{ ...slot, canchaId: 'c1' }], 'same-generation-key');

    expect(replay).toMatchObject({ id: 'j-new-1', idempotencyReplayed: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.notificationOutbox.createMany).not.toHaveBeenCalled();
  });

  it('rechaza reutilizar una clave con una programación diferente', async () => {
    arrange(true);
    await jornadaService.generateNext(divisionId, [{ ...slot, canchaId: 'c1' }], 'reused-generation-key');
    const createData = ((jornadaRepository as any).create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    (prisma.jornada.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...createData,
      id: 'j-new-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(jornadaService.generateNext(divisionId, [{ ...slot, horaInicio: '19:00', horaFin: '20:00', canchaId: 'c1' }], 'reused-generation-key'))
      .rejects.toThrow('clave de idempotencia ya fue usada');
  });

  it('rechaza una cancha distinta a la fija y una cancha fija inactiva', async () => {
    arrange(true);
    mockDivision({ duracionPartido: 60, multiplesCanchas: true, canchaUnicaId: 'c1' });
    await expect(jornadaService.generateNext(divisionId, [{ ...slot, canchaId: 'c2' }]))
      .rejects.toThrow('cancha fija de la división');

    arrange(true);
    mockDivision({ duracionPartido: 60, multiplesCanchas: true, canchaUnicaId: 'inactive' });
    await expect(jornadaService.generateNext(divisionId, [slot]))
      .rejects.toThrow('cancha fija de la división no está activa');
  });

  it('rejects MULTIPLE mode with fewer than two active named courts', async () => {
    arrange(true);
    (prisma.ligaCancha.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'c1', nombre: 'Cancha 1', activa: true },
    ]);
    await expect(jornadaService.generateNext(divisionId, [{ ...slot, canchaId: 'c1' }]))
      .rejects.toThrow('al menos 2 canchas activas');
  });

  it('uses persisted division duration for league-wide occupancy', async () => {
    arrange(true);
    (prisma.partido.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{
      id: 'other-division-match',
      canchaId: 'c1',
      fecha: new Date(2099, 0, 1, 17, 30),
      jornada: { division: { duracionPartido: 120 } },
      rondaPlayoff: null,
    }]);
    await expect(jornadaService.generateNext(divisionId, [{ ...slot, canchaId: 'c1' }]))
      .rejects.toThrow('ya tiene otro partido programado');
  });

  it('allows an old non-overlapping match with no assigned court', async () => {
    arrange(true);
    (prisma.partido.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{
      id: 'old-unassigned',
      canchaId: null,
      fecha: new Date(2098, 0, 1, 18, 0),
      jornada: { division: { duracionPartido: 60 } },
      rondaPlayoff: null,
    }]);

    await expect(jornadaService.generateNext(divisionId, [{ ...slot, canchaId: 'c1' }])).resolves.toBeDefined();
  });

  it('blocks overlapping occupancy whose court is unresolved', async () => {
    arrange(true);
    (prisma.partido.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{
      id: 'overlapping-unassigned',
      canchaId: null,
      fecha: new Date(2099, 0, 1, 18, 30),
      jornada: { division: { duracionPartido: 60 } },
      rondaPlayoff: null,
    }]);

    await expect(jornadaService.generateNext(divisionId, [{ ...slot, canchaId: 'c1' }]))
      .rejects.toThrow('se solapa con el horario solicitado y no tiene una cancha activa válida');
  });

  it('allows non-overlapping history assigned to an inactive court', async () => {
    arrange(true);
    (prisma.partido.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{
      id: 'old-inactive-court',
      canchaId: 'inactive-court',
      fecha: new Date(2098, 5, 1, 18, 0),
      jornada: { division: { duracionPartido: 90 } },
      rondaPlayoff: null,
    }]);

    await expect(jornadaService.generateNext(divisionId, [{ ...slot, canchaId: 'c1' }])).resolves.toBeDefined();
    expect(prisma.partido.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ fecha: expect.objectContaining({ lt: new Date(2099, 0, 1, 19, 0) }) }),
    }));
  });

  it('commits with Serializable isolation and preserves the validated court', async () => {
    arrange(true);
    await jornadaService.generateNext(divisionId, [{ ...slot, canchaId: 'c1' }]);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(partidoRepository.create).toHaveBeenCalledWith(expect.objectContaining({ canchaId: 'c1' }));
  });

  it('maps nested PostgreSQL exclusion errors without masking unrelated P2004 errors', async () => {
    arrange(true);
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error('constraint failed'), {
      code: 'P2004',
      meta: { database_error: { code: '23P01', constraint: 'partidos_cancha_no_overlap' } },
    }));
    await expect(jornadaService.generateNext(divisionId, [{ ...slot, canchaId: 'c1' }]))
      .rejects.toThrow('La cancha ya fue ocupada por otro partido');

    arrange(true);
    const unrelated = Object.assign(new Error('other check failed'), { code: 'P2004' });
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(unrelated);
    await expect(jornadaService.generateNext(divisionId, [{ ...slot, canchaId: 'c1' }])).rejects.toBe(unrelated);
  });
});
