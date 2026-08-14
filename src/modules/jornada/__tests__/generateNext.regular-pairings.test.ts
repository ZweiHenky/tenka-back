import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  divisionId, jornadaRepository, jornadaService, mockDivision, mockJornadaCreated,
  mockNoPreviousJornadas, mockPartidosCreatedReturn, mockTeams, partidoRepository,
  prisma, resetGenerateNextHarness, TEAMS,
} from './support/generateNextHarness';

beforeEach(resetGenerateNextHarness);

describe('generateNext regular pairings', () => {
  it('recalcula todo el plan cuando otra jornada gana el lock primero', async () => {
    mockDivision({ maxEquipos: 4, diasPartido: null });
    mockTeams(['t1', 't2', 't3', 't4']);
    (jornadaRepository.findByDivision as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({
        rows: [{
          id: 'jornada-concurrente',
          numero: 1,
          fechaInicio: null,
          partidos: [{ equipoLocalId: 't1', equipoVisitanteId: 't2', tipoPartido: 'REGULAR', fecha: null }],
        }],
      });
    mockJornadaCreated(2);

    await jornadaService.generateNext(divisionId);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect((jornadaRepository as any).create).toHaveBeenCalledOnce();
    expect((jornadaRepository as any).create).toHaveBeenCalledWith(expect.objectContaining({ numero: 2 }));
  });

  it('recalcula el plan si cambian participantes con el mismo número de jornada', async () => {
    mockDivision({ maxEquipos: 4, diasPartido: null });
    mockTeams(['t1', 't2', 't3', 't4']);
    const originalHistory = {
      id: 'jornada-1',
      numero: 1,
      fechaInicio: null,
      partidos: [{ id: 'partido-1', equipoLocalId: 't1', equipoVisitanteId: 't2', tipoPartido: 'REGULAR', fecha: null }],
    };
    const changedHistory = {
      ...originalHistory,
      partidos: [{ id: 'partido-1', equipoLocalId: 't1', equipoVisitanteId: 't3', tipoPartido: 'REGULAR', fecha: null }],
    };
    (jornadaRepository.findByDivision as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [originalHistory] })
      .mockResolvedValue({ rows: [changedHistory] });
    mockJornadaCreated(2);

    await jornadaService.generateNext(divisionId);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect((jornadaRepository as any).create).toHaveBeenCalledOnce();
    expect((jornadaRepository as any).create).toHaveBeenCalledWith(expect.objectContaining({ numero: 2 }));
  });

  it('lanza ValidationError si hay menos de 2 equipos', async () => {
    mockDivision();
    mockTeams(['t1']);
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await expect(jornadaService.generateNext(divisionId)).rejects.toThrow('Se necesitan al menos 2 equipos');
  });

  it('rechaza descanso con una selección par', async () => {
    mockDivision({ maxEquipos: 6, diasPartido: null });
    mockTeams(['t1', 't2', 't3', 't4', 't5', 't6']);
    mockNoPreviousJornadas();

    await expect(jornadaService.generateNextWithSelection(undefined, ['t1', 't2', 't3', 't4', 't5', 't6'], 't6'))
      .rejects.toThrow('cantidad de equipos es par');
  });

  it('rechaza equipos seleccionados que no pertenecen a la división', async () => {
    mockDivision({ maxEquipos: 6, diasPartido: null });
    mockTeams(['t1', 't2']);
    mockNoPreviousJornadas();

    await expect(jornadaService.generateNextWithSelection(undefined, ['t1', 'unknown']))
      .rejects.toThrow('no pertenecen a esta división');
  });

  it('respeta el descanso con selección impar y programa al resto una vez', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await jornadaService.generateNextWithSelection(undefined, TEAMS.map((team) => team.id), 't7');

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    const participants = calls.flatMap(([args]: any[]) => [args.equipoLocalId, args.equipoVisitanteId]);
    expect(calls).toHaveLength(3);
    expect(participants).not.toContain('t7');
    expect(new Set(participants).size).toBe(6);
  });

  it('rechaza un descanso que también está fijado en un slot regular', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();

    await expect(jornadaService.generateNextWithSelection([
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't7', equipoVisitanteId: 't1' },
      ...Array.from({ length: 2 }, (_, index) => ({ fecha: `2099-01-0${index + 2}`, horaInicio: '18:00', horaFin: '19:30' })),
    ], TEAMS.map((team) => team.id), 't7')).rejects.toThrow('ya está asignado a un partido regular');
  });

  it('8 equipos sin slots → 4 partidos round-robin', async () => {
    const eightTeams = [
      ...TEAMS,
      { id: 't8', nombre: 'Rayos' },
    ];
    mockDivision({ maxEquipos: 8, diasPartido: null });
    (prisma.divisionEquipo.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      eightTeams.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })),
    );
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(4);

    await jornadaService.generateNext(divisionId);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(4);
    const allTeams = new Set(calls.map(([args]: any[]) => args.equipoLocalId).concat(calls.map(([args]: any[]) => args.equipoVisitanteId)));
    eightTeams.forEach((t: any) => expect(allTeams.has(t.id)).toBe(true));
  });

  it('7 equipos sin slots → 3 partidos (1 descansa)', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(3);

    await jornadaService.generateNext(divisionId);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(3);
    const usedTeams = new Set(calls.map(([args]: any[]) => args.equipoLocalId).concat(calls.map(([args]: any[]) => args.equipoVisitanteId)));
    expect(usedTeams.size).toBe(6);
    expect(usedTeams.has('DESCANSO')).toBe(false);
  });

  it('rotación con jornadas previas (r=4) → pairings diferentes a J1', async () => {
    mockDivision();
    mockTeams();
    (jornadaRepository.findByDivision as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [1, 2, 3, 4].map((numero) => ({
        numero,
        partidos: [{ equipoLocalId: 'history-a', equipoVisitanteId: 'history-b', tipoPartido: 'REGULAR' }],
      })),
    });
    mockJornadaCreated(5);
    mockPartidosCreatedReturn(3);

    await jornadaService.generateNext(divisionId);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(3);
    // r=4 → t1 vs t6 (no t1 vs t2 como en J1)
    const hasT1vsT2 = calls.some(([args]: any[]) => args.equipoLocalId === 't1' && args.equipoVisitanteId === 't2');
    expect(hasT1vsT2).toBe(false);
    // Verificar que rotó: algún pairing esperado con r=4
    const hasT1vsT6 = calls.some(([args]: any[]) => (args.equipoLocalId === 't1' && args.equipoVisitanteId === 't6') || (args.equipoLocalId === 't6' && args.equipoVisitanteId === 't1'));
    expect(hasT1vsT6).toBe(true);
  });

  it('5 equipos sin slots → 2 partidos + 1 descanso', async () => {
    mockDivision({ maxEquipos: 5, diasPartido: null });
    (prisma.divisionEquipo.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      TEAMS.slice(0, 5).map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })),
    );
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(2);

    await jornadaService.generateNext(divisionId);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2);
    const usedTeams = new Set(calls.map(([args]: any[]) => args.equipoLocalId).concat(calls.map(([args]: any[]) => args.equipoVisitanteId)));
    expect(usedTeams.size).toBe(4);
    expect(usedTeams.has('DESCANSO')).toBe(false);
  });

  it('amistoso previo no bloquea cruce regular', async () => {
    mockDivision();
    mockTeams();
    (jornadaRepository.findByDivision as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{
        numero: 1,
        partidos: [{
          equipoLocalId: 't1',
          equipoVisitanteId: 't2',
          tipoPartido: 'AMISTOSO',
        }],
      }],
    });
    mockJornadaCreated(2);
    mockPartidosCreatedReturn(3);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-08', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1' },
      { fecha: '2099-01-09', horaInicio: '18:00', horaFin: '19:30' },
      { fecha: '2099-01-10', horaInicio: '18:00', horaFin: '19:30' },
    ]);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    const t1Match = calls.find(([args]: any[]) => args.equipoLocalId === 't1' || args.equipoVisitanteId === 't1');
    expect(t1Match).toBeDefined();
    const [t1Args] = t1Match as [any];
    const opponent = t1Args.equipoLocalId === 't1' ? t1Args.equipoVisitanteId : t1Args.equipoLocalId;
    expect(opponent).toBeDefined();
  });

  it('usa el historial real para evitar los cruces ya jugados', async () => {
    mockDivision({ maxEquipos: 6, diasPartido: null });
    const sixTeams = TEAMS.slice(0, 6);
    (prisma.divisionEquipo.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      sixTeams.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })),
    );

    (jornadaRepository.findByDivision as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{ numero: 1, partidos: [
        { equipoLocalId: 't1', equipoVisitanteId: 't2', tipoPartido: 'REGULAR' },
        { equipoLocalId: 't3', equipoVisitanteId: 't4', tipoPartido: 'REGULAR' },
        { equipoLocalId: 't5', equipoVisitanteId: 't6', tipoPartido: 'REGULAR' },
      ] }],
    });
    mockJornadaCreated(2);
    await jornadaService.generateNext(divisionId);

    const keys = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls.map(([args]: any[]) =>
      [args.equipoLocalId, args.equipoVisitanteId].sort().join('-'));
    expect(keys).not.toContain('t1-t2');
    expect(keys).not.toContain('t3-t4');
    expect(keys).not.toContain('t5-t6');
  });
});
