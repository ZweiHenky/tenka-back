import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database', async () => (await import('./service.test-mocks')).databaseModuleMock);
vi.mock('./repository', async () => (await import('./service.test-mocks')).repositoryModuleMock);
vi.mock('../tabla-posicion/service', async () => (await import('./service.test-mocks')).tablaPosicionModuleMock);
vi.mock('../ronda-playoff/service', async () => (await import('./service.test-mocks')).rondaPlayoffModuleMock);

import {
  context,
  owner,
  partidoRepository,
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
    expect(prisma.partido.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'future-a' }) }));
    expect(prisma.partido.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'future-b' }) }));
    const writeIds = vi.mocked(prisma.partido.updateMany).mock.calls.map(([query]: any[]) => query.where.id);
    expect(writeIds).toEqual([...writeIds].sort((a, b) => a.localeCompare(b)));
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
    expect(prisma.partido.updateMany).not.toHaveBeenCalled();
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
    expect(prisma.partido.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'future' }),
      data: { equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-3', notas: null },
    }));
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

    expect(prisma.partido.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'future-a' }),
      data: { equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-3', notas: null },
    }))
    expect(prisma.partido.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'future-b' }),
      data: { equipoLocalId: 'equipo-2', equipoVisitanteId: 'equipo-4', notas: null },
    }))
  })

  it('aborts without writes when the target changes after the preflight read', async () => {
    vi.mocked(prisma.jornada.findMany).mockResolvedValue([{
      id: 'jornada-1', numero: 1, partidos: [
        { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
        { id: 'partido-2', estado: 'FINALIZADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
      ],
    }] as any);

    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
      .rejects.toThrow('El partido del equipo seleccionado debe estar programado');

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.partido.updateMany).not.toHaveBeenCalled();
  });

  it('derives the target and participants from the transactional jornada snapshot', async () => {
    vi.mocked(prisma.jornada.findMany).mockResolvedValue([{
      id: 'jornada-1', numero: 1, partidos: [
        { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
        { id: 'partido-2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-4', equipoVisitanteId: 'equipo-3' },
      ],
    }] as any);

    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner)).resolves.toBeDefined();
    expect(prisma.partido.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'partido-2', equipoLocalId: 'equipo-4', equipoVisitanteId: 'equipo-3' }),
      data: { equipoLocalId: 'equipo-4', equipoVisitanteId: 'equipo-1', notas: null },
    }));
  });

  it('retries the full serializable transaction after a conditional plan goes stale', async () => {
    vi.mocked(prisma.partido.updateMany).mockResolvedValueOnce({ count: 0 }).mockResolvedValue({ count: 1 });

    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner)).resolves.toBeDefined();

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(partidoRepository.findAuthorizationContext).toHaveBeenCalledTimes(3);
  });

  it('maps exhausted serialization retries to a 409 conflict', async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(Object.assign(new Error('serialization failure'), { code: 'P2034' }));

    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('maps three stale conditional plans to a 409 conflict', async () => {
    vi.mocked(prisma.partido.updateMany).mockResolvedValue({ count: 0 });

    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
  });
});
