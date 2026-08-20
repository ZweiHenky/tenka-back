import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  divisionId, jornadaService, mockDivision, mockJornadaCreated,
  mockNoPreviousJornadas, mockPartidosCreatedReturn, mockTeams,
  partidoRepository, prisma, resetGenerateNextHarness,
} from './support/generateNextHarness';

beforeEach(resetGenerateNextHarness);

describe('generateNext conflictos de cancha', () => {
  function mockCanchas() {
    (prisma.ligaCancha.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'c1', nombre: 'Cancha 1' },
      { id: 'c2', nombre: 'Cancha 2' },
    ]);
  }

  it('rechaza horarios solapados cuando no hay canchas configuradas', async () => {
    mockDivision({ maxEquipos: 4, diasPartido: null, duracionPartido: 60 });
    mockTeams(['t1', 't2', 't3', 't4']);
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await expect(jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', equipoLocalId: 't1', equipoVisitanteId: 't2' },
      { fecha: '2099-01-01', horaInicio: '18:30', horaFin: '19:30', equipoLocalId: 't3', equipoVisitanteId: 't4' },
    ])).rejects.toThrow('ya tiene otro partido programado');
  });

  it('permite horarios consecutivos cuando no hay canchas configuradas', async () => {
    mockDivision({ maxEquipos: 4, diasPartido: null, duracionPartido: 60 });
    mockTeams(['t1', 't2', 't3', 't4']);
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(2);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', equipoLocalId: 't1', equipoVisitanteId: 't2' },
      { fecha: '2099-01-01', horaInicio: '19:00', horaFin: '20:00', equipoLocalId: 't3', equipoVisitanteId: 't4' },
    ]);

    expect(partidoRepository.create).toHaveBeenCalled();
  });

  it('rechaza dos tipos de partido solapados en la misma cancha', async () => {
    mockDivision({ maxEquipos: 4, diasPartido: null, duracionPartido: 60, multiplesCanchas: true });
    mockTeams(['t1', 't2', 't3', 't4']);
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockCanchas();
    (prisma.partido.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await expect(jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' },
      { fecha: '2099-01-01', horaInicio: '18:30', horaFin: '19:30', equipoLocalId: 't3', equipoVisitanteId: 't4', canchaId: 'c1' },
    ])).rejects.toThrow('ya tiene otro partido programado');
  });

  it('permite partidos simultáneos en canchas diferentes', async () => {
    mockDivision({ maxEquipos: 4, diasPartido: null, duracionPartido: 60, multiplesCanchas: true });
    mockTeams(['t1', 't2', 't3', 't4']);
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockCanchas();
    (prisma.partido.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' },
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', equipoLocalId: 't3', equipoVisitanteId: 't4', canchaId: 'c2' },
    ]);

    expect(partidoRepository.create).toHaveBeenCalled();
  });

  it('permite partidos consecutivos en la misma cancha', async () => {
    mockDivision({ maxEquipos: 4, diasPartido: null, duracionPartido: 60, multiplesCanchas: true });
    mockTeams(['t1', 't2', 't3', 't4']);
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockCanchas();
    (prisma.partido.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' },
      { fecha: '2099-01-01', horaInicio: '19:00', horaFin: '20:00', equipoLocalId: 't3', equipoVisitanteId: 't4', canchaId: 'c1' },
    ]);

    expect(partidoRepository.create).toHaveBeenCalled();
  });

  it('rechaza conflicto con partido existente de otra división', async () => {
    mockDivision({ maxEquipos: 4, diasPartido: null, duracionPartido: 60, multiplesCanchas: true });
    mockTeams(['t1', 't2']);
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockCanchas();
    (prisma.partido.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'partido-otra-division', canchaId: 'c1', fecha: new Date(2099, 0, 1, 18, 30), jornada: { division: { duracionPartido: 60 } }, rondaPlayoff: null },
    ]);

    await expect(jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' },
    ])).rejects.toThrow('ya tiene otro partido programado');
  });

  describe('alcance de la consulta de ocupación', () => {
    function setup(maxDuracionLiga: number) {
      mockDivision({ maxEquipos: 4, diasPartido: null, duracionPartido: 60, multiplesCanchas: true });
      mockTeams(['t1', 't2']);
      mockNoPreviousJornadas();
      mockJornadaCreated();
      mockPartidosCreatedReturn(1);
      mockCanchas();
      (prisma.division.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({ _max: { duracionPartido: maxDuracionLiga } });
      (prisma.partido.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    }

    const draft = { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' };

    // The window spans [earliestDraftStart - margin, latestDraftEnd); with a single 60-minute
    // draft that is margin + 60 minutes. Asserting the span keeps this timezone-agnostic.
    function occupancyWindowMinutes() {
      const where = (prisma.partido.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].where;
      expect(where.fecha.gte).toBeInstanceOf(Date);
      return (where.fecha.lt.getTime() - where.fecha.gte.getTime()) / 60_000;
    }

    it('acota la consulta con un piso, en vez de leer todo el historial', async () => {
      setup(120);

      await jornadaService.generateNext(divisionId, [draft]);

      // The 1440-minute guard wins over the league's 120-minute max.
      expect(occupancyWindowMinutes()).toBe(1440 + 60);
    });

    it('ensancha el piso cuando una división dura más que el margen por defecto', async () => {
      setup(3000);

      await jornadaService.generateNext(divisionId, [draft]);

      expect(occupancyWindowMinutes()).toBe(3000 + 60);
    });

    it('usa el margen por defecto cuando la liga no tiene ninguna duración', async () => {
      setup(0);
      (prisma.division.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({ _max: { duracionPartido: null } });

      await jornadaService.generateNext(divisionId, [draft]);

      expect(occupancyWindowMinutes()).toBe(1440 + 60);
    });
  });

  describe('división sin duración configurada', () => {
    function setupBadDivision(canchaId: string | null) {
      mockDivision({ maxEquipos: 4, diasPartido: null, duracionPartido: 60, multiplesCanchas: true });
      mockTeams(['t1', 't2']);
      mockNoPreviousJornadas();
      mockJornadaCreated();
      mockPartidosCreatedReturn(1);
      mockCanchas();
      (prisma.partido.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'partido-sin-duracion',
          canchaId,
          fecha: new Date(2099, 0, 1, 18, 30),
          jornada: { division: { id: 'div-mala', nombre: 'Femenil B', duracionPartido: null } },
          rondaPlayoff: null,
        },
      ]);
    }

    const draft = { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' };

    it('no bloquea a otras divisiones cuando el partido inmensurable está en otra cancha', async () => {
      setupBadDivision('c2');

      await jornadaService.generateNext(divisionId, [draft]);

      expect(partidoRepository.create).toHaveBeenCalled();
    });

    it('bloquea nombrando la división culpable cuando comparte la cancha', async () => {
      setupBadDivision('c1');

      await expect(jornadaService.generateNext(divisionId, [draft]))
        .rejects.toThrow(/Femenil B.*div-mala/);
    });
  });
});
