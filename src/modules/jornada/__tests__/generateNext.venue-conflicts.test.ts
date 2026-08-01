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
    mockDivision({ maxEquipos: 4, diasPartido: null });
    mockTeams(['t1', 't2', 't3', 't4']);
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await expect(jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2' },
      { fecha: '2099-01-01', horaInicio: '18:30', horaFin: '19:30', equipoLocalId: 't3', equipoVisitanteId: 't4' },
    ])).rejects.toThrow('Hay partidos con horarios solapados');
  });

  it('permite horarios consecutivos cuando no hay canchas configuradas', async () => {
    mockDivision({ maxEquipos: 4, diasPartido: null });
    mockTeams(['t1', 't2', 't3', 't4']);
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(2);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2' },
      { fecha: '2099-01-01', horaInicio: '19:00', horaFin: '20:00', tipo: 'amistoso', equipoLocalId: 't3', equipoVisitanteId: 't4' },
    ]);

    expect(partidoRepository.create).toHaveBeenCalled();
  });

  it('rechaza dos tipos de partido solapados en la misma cancha', async () => {
    mockDivision({ maxEquipos: 4, diasPartido: null });
    mockTeams(['t1', 't2', 't3', 't4']);
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockCanchas();
    (prisma.partido.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await expect(jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' },
      { fecha: '2099-01-01', horaInicio: '18:30', horaFin: '19:30', equipoLocalId: 't3', equipoVisitanteId: 't4', canchaId: 'c1' },
    ])).rejects.toThrow('horarios solapados');
  });

  it('permite partidos simultáneos en canchas diferentes', async () => {
    mockDivision({ maxEquipos: 4, diasPartido: null });
    mockTeams(['t1', 't2', 't3', 't4']);
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockCanchas();
    (prisma.partido.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ fecha: new Date('2099-01-01T18:00:00'), fechaFin: new Date('2099-01-01T19:00:00') }]);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' },
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't3', equipoVisitanteId: 't4', canchaId: 'c2' },
    ]);

    expect(partidoRepository.create).toHaveBeenCalled();
  });

  it('permite partidos consecutivos en la misma cancha', async () => {
    mockDivision({ maxEquipos: 4, diasPartido: null });
    mockTeams(['t1', 't2', 't3', 't4']);
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockCanchas();
    (prisma.partido.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ fecha: new Date('2099-01-01T18:00:00'), fechaFin: new Date('2099-01-01T20:00:00') }]);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' },
      { fecha: '2099-01-01', horaInicio: '19:00', horaFin: '20:00', tipo: 'amistoso', equipoLocalId: 't3', equipoVisitanteId: 't4', canchaId: 'c1' },
    ]);

    expect(partidoRepository.create).toHaveBeenCalled();
  });

  it('rechaza conflicto con partido existente de otra división', async () => {
    mockDivision({ maxEquipos: 4, diasPartido: null });
    mockTeams(['t1', 't2']);
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockCanchas();
    (prisma.partido.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'partido-otra-division', canchaId: 'c1', fecha: new Date(2099, 0, 1, 18, 30), fechaFin: new Date(2099, 0, 1, 19, 30) },
    ]);

    await expect(jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' },
    ])).rejects.toThrow('ya tiene otro partido programado');
  });
});
