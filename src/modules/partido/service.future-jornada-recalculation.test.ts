import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database', async () => (await import('./service.test-mocks')).databaseModuleMock);
vi.mock('./repository', async () => (await import('./service.test-mocks')).repositoryModuleMock);
vi.mock('../tabla-posicion/service', async () => (await import('./service.test-mocks')).tablaPosicionModuleMock);
vi.mock('../ronda-playoff/service', async () => (await import('./service.test-mocks')).rondaPlayoffModuleMock);

import {
  context,
  owner,
  partidoService,
  prisma,
  resetServiceTestHarness,
} from './service.test-harness';

beforeEach(resetServiceTestHarness);

describe('partidoService future jornada recalculation', () => {
  it('preserves future partido ids and reports recalculated jornadas', async () => {
    vi.mocked(prisma.jornada.findMany)
      .mockReset()
      .mockResolvedValue([
        { id: 'jornada-1', numero: 1, partidos: [
          { id: 'partido-1', estado: 'PROGRAMADO', fecha: context.fecha, equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
          { id: 'partido-2', estado: 'PROGRAMADO', fecha: new Date('2026-08-01T20:00:00Z'), equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
        ] },
        { id: 'jornada-2', numero: 2, partidos: [
          { id: 'future-b', estado: 'PROGRAMADO', fecha: new Date('2026-08-08T20:00:00Z'), equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-3' },
          { id: 'future-a', estado: 'PROGRAMADO', fecha: new Date('2026-08-08T18:00:00Z'), equipoLocalId: 'equipo-2', equipoVisitanteId: 'equipo-4' },
        ] },
      ] as any);

    const result = await partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner) as any;

    expect(result.jornadasRecalculadas).toBe(1);
    expect(prisma.partido.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'future-a' } }));
    expect(prisma.partido.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'future-b' } }));
  });

  it('blocks a future regular match that is not programmed before writes', async () => {
    vi.mocked(prisma.jornada.findMany).mockReset().mockResolvedValueOnce([
      { id: 'jornada-1', numero: 1, partidos: [
        { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
        { id: 'partido-2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
      ] },
      { id: 'jornada-2', numero: 2, partidos: [{ id: 'future', estado: 'FINALIZADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-4' }] },
    ] as any);

    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
      .rejects.toThrow('jornadas posteriores deben estar programados');
    expect(prisma.partido.update).not.toHaveBeenCalled();
  });

  it('repeats a future pairing instead of failing when all options are exhausted', async () => {
    vi.mocked(prisma.jornada.findMany).mockReset()
      .mockResolvedValue([
        { id: 'jornada-0', numero: 0, partidos: [
          { id: 'history', estado: 'FINALIZADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-3' },
        ] },
        { id: 'jornada-1', numero: 1, partidos: [
          { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
          { id: 'partido-2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
        ] },
        { id: 'jornada-2', numero: 2, partidos: [{ id: 'future', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-3' }] },
      ] as any);

    const result = await partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner) as any;

    expect(result.jornadasRecalculadas).toBe(1);
    expect(prisma.partido.update).toHaveBeenCalledWith({
      where: { id: 'future' },
      data: { equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-3' },
    });
  });

  it('prefers the globally least-used perfect matching for a future jornada', async () => {
    vi.mocked(prisma.jornada.findMany).mockReset().mockResolvedValue([
      { id: 'history-1', numero: -2, partidos: [
        { id: 'h1', estado: 'FINALIZADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
        { id: 'h2', estado: 'FINALIZADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-4' },
        { id: 'h3', estado: 'FINALIZADO', equipoLocalId: 'equipo-2', equipoVisitanteId: 'equipo-3' },
      ] },
      { id: 'history-2', numero: -1, partidos: [
        { id: 'h4', estado: 'FINALIZADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
        { id: 'h5', estado: 'FINALIZADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-4' },
        { id: 'h6', estado: 'FINALIZADO', equipoLocalId: 'equipo-2', equipoVisitanteId: 'equipo-3' },
      ] },
      { id: 'jornada-1', numero: 1, partidos: [
        { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
        { id: 'partido-2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
      ] },
      { id: 'jornada-2', numero: 2, partidos: [
        { id: 'future-a', estado: 'PROGRAMADO', fecha: new Date('2026-08-08T18:00:00Z'), equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-3' },
        { id: 'future-b', estado: 'PROGRAMADO', fecha: new Date('2026-08-08T20:00:00Z'), equipoLocalId: 'equipo-2', equipoVisitanteId: 'equipo-4' },
      ] },
    ] as any)

    await partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner)

    expect(prisma.partido.update).toHaveBeenCalledWith({
      where: { id: 'future-a' },
      data: { equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-3' },
    })
    expect(prisma.partido.update).toHaveBeenCalledWith({
      where: { id: 'future-b' },
      data: { equipoLocalId: 'equipo-2', equipoVisitanteId: 'equipo-4' },
    })
  })

  it('aborts without writes when the target changes after the preflight read', async () => {
    vi.mocked(prisma.jornada.findMany).mockResolvedValue([{
      id: 'jornada-1', numero: 1, partidos: [
        { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
        { id: 'partido-2', estado: 'FINALIZADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
      ],
    }] as any);

    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
      .rejects.toThrow('Los partidos del intercambio deben continuar programados');

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.partido.update).not.toHaveBeenCalled();
  });

  it('does not overwrite participants changed after the preflight read', async () => {
    vi.mocked(prisma.jornada.findMany).mockResolvedValue([{
      id: 'jornada-1', numero: 1, partidos: [
        { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
        { id: 'partido-2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-4', equipoVisitanteId: 'equipo-3' },
      ],
    }] as any);

    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
      .rejects.toThrow('Los participantes de los partidos del intercambio cambiaron');

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.partido.update).not.toHaveBeenCalled();
  });
});
