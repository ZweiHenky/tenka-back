import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database', async () => (await import('./service.test-mocks')).databaseModuleMock);
vi.mock('./repository', async () => (await import('./service.test-mocks')).repositoryModuleMock);
vi.mock('../tabla-posicion/service', async () => (await import('./service.test-mocks')).tablaPosicionModuleMock);
vi.mock('../ronda-playoff/service', async () => (await import('./service.test-mocks')).rondaPlayoffModuleMock);

import {
  admin,
  context,
  other,
  owner,
  partidoRepository,
  partidoService,
  prisma,
  resetServiceTestHarness,
} from './service.test-harness';

beforeEach(resetServiceTestHarness);

describe('partidoService.update team replacement', () => {
  it('does not apply replacement checks to score/result updates', async () => {
    await partidoService.update('partido-1', { golesLocal: 2 }, owner);

    expect(prisma.divisionEquipo.count).not.toHaveBeenCalled();
    expect(prisma.partido.findFirst).not.toHaveBeenCalled();
    expect(partidoRepository.update).toHaveBeenCalledWith('partido-1', { golesLocal: 2 });
  });

  it('swaps teams while preserving each selected side', async () => {
    await partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner);

    expect(prisma.divisionEquipo.count).toHaveBeenCalledWith({
      where: { divisionId: 'division-1', equipoId: 'equipo-3' },
    });
    expect(prisma.partido.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { not: 'partido-1' },
        jornadaId: 'jornada-1',
        tipoPartido: 'REGULAR',
      }),
    }));
    expect(prisma.partido.update).toHaveBeenCalledWith({
      where: { id: 'partido-2' }, data: { equipoLocalId: 'equipo-1' },
    });
    expect(prisma.partido.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'partido-1' }, data: { equipoLocalId: 'equipo-3' },
    }));
    expect(prisma.partido.findFirst).toHaveBeenCalledOnce();
    expect(prisma.partido.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { notIn: ['partido-1', 'partido-2'] } }),
    }));
  });

  it('allows the resulting unordered pair when it occurred in a prior jornada', async () => {
    vi.mocked(prisma.jornada.findMany).mockResolvedValue([
      { id: 'jornada-0', numero: 0, partidos: [
        { id: 'history', estado: 'FINALIZADO', equipoLocalId: 'equipo-2', equipoVisitanteId: 'equipo-3' },
      ] },
      { id: 'jornada-1', numero: 1, partidos: [
        { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
        { id: 'partido-2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
      ] },
    ] as any)

    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner)).resolves.toBeDefined()
  })

  it.each([
    ['same order', 'equipo-3', 'equipo-2'],
    ['reversed order', 'equipo-2', 'equipo-3'],
  ])('rejects a duplicate unordered pair in the simulated current jornada: %s', async (_label, local, visitor) => {
    vi.mocked(prisma.jornada.findMany).mockResolvedValue([{ id: 'jornada-1', numero: 1, partidos: [
      { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
      { id: 'partido-2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
      { id: 'duplicate', estado: 'PROGRAMADO', equipoLocalId: local, equipoVisitanteId: visitor },
    ] }] as any)

    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
      .rejects.toThrow('El intercambio produciría un enfrentamiento duplicado dentro de la jornada actual')
    expect(prisma.partido.update).not.toHaveBeenCalled()
  })

  it('blocks when the incoming team has no match in the jornada', async () => {
    vi.mocked(prisma.partido.findMany).mockResolvedValue([]);
    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
      .rejects.toThrow('no tiene otro partido en esta jornada');
  });

  it('blocks an ambiguous incoming team appearance', async () => {
    vi.mocked(prisma.partido.findMany).mockResolvedValue([{ id: 'p2' }, { id: 'p3' }] as any);
    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
      .rejects.toThrow('intercambio es ambiguo');
  });

  it('blocks a target match that is not PROGRAMADO', async () => {
    vi.mocked(prisma.partido.findMany).mockResolvedValue([{
      id: 'partido-2', estado: 'FINALIZADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4',
    }] as any);
    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
      .rejects.toThrow('partido del equipo seleccionado debe estar programado');
  });

  it('rejects replacement unless the match is PROGRAMADO', async () => {
    vi.mocked(partidoRepository.findAuthorizationContext).mockResolvedValue({ ...context, estado: null });

    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
      .rejects.toThrow('Solo se pueden reemplazar equipos en partidos programados');
  });

  it('rejects playoff matches', async () => {
    vi.mocked(partidoRepository.findAuthorizationContext).mockResolvedValue({
      ...context,
      jornadaId: null,
      rondaPlayoffId: 'ronda-1',
    });

    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
      .rejects.toThrow('Solo se pueden reemplazar equipos en partidos regulares de jornada');
  });

  it('rejects a team outside the jornada division', async () => {
    vi.mocked(prisma.divisionEquipo.count).mockResolvedValue(0);

    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
      .rejects.toThrow('El equipo de reemplazo no pertenece a la división de la jornada');
  });

  it('rejects making local and visitor the same team', async () => {
    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-2' }, owner))
      .rejects.toThrow('El equipo local y visitante deben ser diferentes');
  });

  it('rejects when the outgoing team would face itself in the target match', async () => {
    vi.mocked(prisma.partido.findMany).mockResolvedValue([{
      id: 'partido-2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-1',
      fecha: new Date('2026-08-01T20:00:00Z'), fechaFin: new Date('2026-08-01T21:00:00Z'),
    }] as any);
    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
      .rejects.toThrow('mismo equipo como local y visitante');
  });

  it('rejects an overlapping match in the same division', async () => {
    vi.mocked(prisma.partido.findFirst).mockResolvedValue({ id: 'other-match' } as any);

    await expect(partidoService.update('partido-1', { equipoVisitanteId: 'equipo-3' }, owner))
      .rejects.toThrow('Uno de los equipos ya tiene un partido en el horario resultante');

    expect(prisma.partido.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { notIn: ['partido-1', 'partido-2'] },
        AND: expect.arrayContaining([{ OR: [
          { jornada: { divisionId: 'division-1' } },
          { rondaPlayoff: { divisionId: 'division-1' } },
        ] }]),
      }),
    }));
  });

  it('checks both resulting intervals in one conflict query', async () => {
    vi.mocked(prisma.partido.findFirst).mockResolvedValue({ id: 'other-match' } as any);

    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, owner))
      .rejects.toThrow('Uno de los equipos ya tiene un partido en el horario resultante');

    expect(prisma.partido.findFirst).toHaveBeenCalledOnce();
    const intervalPredicates = (vi.mocked(prisma.partido.findFirst).mock.calls[0][0] as any).where.AND[1].OR;
    expect(intervalPredicates).toEqual([
      {
        fecha: { lt: context.fechaFin },
        fechaFin: { gt: context.fecha },
        OR: [{ equipoLocalId: 'equipo-3' }, { equipoVisitanteId: 'equipo-3' }],
      },
      {
        fecha: { lt: new Date('2026-08-01T21:00:00Z') },
        fechaFin: { gt: new Date('2026-08-01T20:00:00Z') },
        OR: [{ equipoLocalId: 'equipo-1' }, { equipoVisitanteId: 'equipo-1' }],
      },
    ]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps owner authorization before replacement validation', async () => {
    await expect(partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, other))
      .rejects.toMatchObject({ statusCode: 404 });

    expect(prisma.divisionEquipo.count).not.toHaveBeenCalled();
  });

  it('allows an administrator to update a foreign partido', async () => {
    await partidoService.update('partido-1', { golesLocal: 2 }, admin);
    expect(partidoRepository.update).toHaveBeenCalled();
  });
});
