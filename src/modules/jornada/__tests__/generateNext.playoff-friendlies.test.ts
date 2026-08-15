import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  divisionId, jornadaRepository, jornadaService, mockDivision, mockJornadaCreated,
  mockNoPreviousJornadas, mockTeams, partidoRepository,
  prisma, resetGenerateNextHarness,
} from './support/generateNextHarness';

beforeEach(resetGenerateNextHarness);

describe('generateNext playoff mode — amistosos auto-fill', () => {
  const TEN_TEAMS = [
    { id: 't1', nombre: 'Águilas' },
    { id: 't2', nombre: 'Dragones' },
    { id: 't3', nombre: 'Genix' },
    { id: 't4', nombre: 'Mi Equipo' },
    { id: 't5', nombre: 'Leones' },
    { id: 't6', nombre: 'Tiburones' },
    { id: 't7', nombre: 'Panteras' },
    { id: 't8', nombre: 'Rayos' },
    { id: 't9', nombre: 'Fénix' },
    { id: 't10', nombre: 'Lobos' },
  ];

  const ELIM_SLOTS = [
    { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'eliminatoria' as const, partidoId: 'p1', equipoLocalId: 't1', equipoVisitanteId: 't2' },
    { fecha: '2099-01-01', horaInicio: '19:30', horaFin: '21:00', tipo: 'eliminatoria' as const, partidoId: 'p2', equipoLocalId: 't3', equipoVisitanteId: 't4' },
  ];

  function mockPlayoffMode() {
    (prisma.rondaPlayoff.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'r1' }]);
  }

  function mockTenTeams() {
    (prisma.divisionEquipo.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      TEN_TEAMS.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })),
    );
  }

  function mockEliminatoriaPartidos() {
    (partidoRepository.findById as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
      const slot = ELIM_SLOTS.find((s) => s.partidoId === id);
      if (!slot) return null;
      return { id, equipoLocalId: slot.equipoLocalId, equipoVisitanteId: slot.equipoVisitanteId, jornadaId: null };
    });
  }

  it('rejects a slot without an explicit friendly or playoff type', async () => {
    mockDivision({ maxEquipos: 10, diasPartido: null });
    mockPlayoffMode();

    await expect(jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30' },
    ])).rejects.toThrow('Solo se permiten partidos amistosos o de eliminatoria');
  });

  it('incluye eliminatorias en conflictos de la misma cancha y excluye el propio partido de la consulta', async () => {
    mockDivision({ maxEquipos: 10, diasPartido: null, multiplesCanchas: true });
    mockPlayoffMode();
    mockTenTeams();
    mockEliminatoriaPartidos();
    mockNoPreviousJornadas();
    mockJornadaCreated();
    (prisma.ligaCancha.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'c1', nombre: 'Cancha 1' },
      { id: 'c2', nombre: 'Cancha 2' },
    ]);
    (prisma.partido.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: 'p1', equipoLocalId: 't1', equipoVisitanteId: 't2', jornadaId: null }])
      .mockResolvedValueOnce([]);

    await expect(jornadaService.generateNext(divisionId, [
      { ...ELIM_SLOTS[0], canchaId: 'c1' },
      { fecha: '2099-01-01', horaInicio: '18:30', horaFin: '20:00', tipo: 'amistoso', equipoLocalId: 't3', equipoVisitanteId: 't4', canchaId: 'c1' },
    ])).rejects.toThrow('ya tiene otro partido programado');

    expect(prisma.partido.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { notIn: ['p1'] } }),
    }));
    expect(partidoRepository.update).not.toHaveBeenCalled();
  });

  it('3 amistosos vacíos con 10 equipos y 4 en eliminatoria → usa 6 equipos libres', async () => {
    mockDivision({ maxEquipos: 10, diasPartido: null });
    mockPlayoffMode();
    mockTenTeams();
    mockEliminatoriaPartidos();
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await jornadaService.generateNext(divisionId, [
      ...ELIM_SLOTS,
      { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso' },
      { fecha: '2099-01-01', horaInicio: '01:30', horaFin: '03:00', tipo: 'amistoso' },
      { fecha: '2099-01-01', horaInicio: '00:00', horaFin: '01:30', tipo: 'amistoso' },
    ]);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    // 3 amistosos (eliminatorias usan update, no create)
    expect(calls.length).toBe(3);

    // Count unique teams in amistosos (should be 6 non-eliminatoria teams)
    const amistosos = calls.filter(([args]: any[]) => args.tipoPartido === 'AMISTOSO');
    expect(amistosos.length).toBe(3);

    const amistosoTeamIds = new Set<string>();
    for (const [args] of amistosos) {
      amistosoTeamIds.add(args.equipoLocalId);
      amistosoTeamIds.add(args.equipoVisitanteId);
    }
    expect(amistosoTeamIds.size).toBe(6);

    // Verify no eliminatoria team is in an amistoso
    for (const id of amistosoTeamIds) {
      expect(['t1', 't2', 't3', 't4'].includes(id)).toBe(false);
    }

    // Verify all non-eliminatoria teams are accounted for
    const nonElimTeams = ['t5', 't6', 't7', 't8', 't9', 't10'];
    for (const id of nonElimTeams) {
      expect(amistosoTeamIds.has(id)).toBe(true);
    }
  });

  it('1 amistoso vacío, no bastan libres → usa equipos de eliminatoria', async () => {
    mockDivision({ maxEquipos: 10, diasPartido: null });
    mockPlayoffMode();
    mockTenTeams();
    mockEliminatoriaPartidos();
    mockNoPreviousJornadas();
    mockJornadaCreated();

    // Only non-eliminatoria teams: t5, t6, t7, t8, t9, t10
    // 3 amistosos need 6 teams, but we have only 6 free ones.
    // 4th amistoso would need eliminatoria teams
    await jornadaService.generateNext(divisionId, [
      ...ELIM_SLOTS,
      { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso' },
      { fecha: '2099-01-01', horaInicio: '01:30', horaFin: '03:00', tipo: 'amistoso' },
      { fecha: '2099-01-01', horaInicio: '00:00', horaFin: '01:30', tipo: 'amistoso' },
      { fecha: '2099-01-01', horaInicio: '03:00', horaFin: '04:30', tipo: 'amistoso' },
    ]);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    // 4 amistosos (eliminatorias usan update, no create)
    expect(calls.length).toBe(4);

    const amistosos = calls.filter(([args]: any[]) => args.tipoPartido === 'AMISTOSO');
    expect(amistosos.length).toBe(4);

    const amistosoTeamIds = new Set<string>();
    for (const [args] of amistosos) {
      amistosoTeamIds.add(args.equipoLocalId);
      amistosoTeamIds.add(args.equipoVisitanteId);
    }
    // 4 amistosos × 2 = 8 team slots, but there are only 10 teams total - 4 eliminatoria = 6 + up to 4 from eliminatoria
    // 6 non-elim + 2 eliminatoria = 8 unique teams
    expect(amistosoTeamIds.size).toBe(8);

    // At least one eliminatoria team should be in amistosos
    const usedElim = [...amistosoTeamIds].filter((id) => ['t1', 't2', 't3', 't4'].includes(id));
    expect(usedElim.length).toBeGreaterThan(0);
  });

  it('amistoso manual no puede duplicar cruce de eliminatoria', async () => {
    mockDivision({ maxEquipos: 10, diasPartido: null });
    mockPlayoffMode();
    mockTenTeams();
    mockEliminatoriaPartidos();
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await expect(jornadaService.generateNext(divisionId, [
      ...ELIM_SLOTS,
      { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2' },
    ])).rejects.toThrow('repite el mismo cruce que un partido de eliminatoria');
  });

  it('amistoso parcial evita duplicado de cruce eliminatoria', async () => {
    mockDivision({ maxEquipos: 10, diasPartido: null });
    mockPlayoffMode();
    mockTenTeams();
    mockEliminatoriaPartidos();
    mockNoPreviousJornadas();
    mockJornadaCreated();

    // Amistoso parcial: t1 assigned, need opponent. t2 is the eliminatoria opponent → should NOT pick t2
    await jornadaService.generateNext(divisionId, [
      ...ELIM_SLOTS,
      { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't1' },
    ]);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    const amistoso = calls.find(([args]: any[]) => args.tipoPartido === 'AMISTOSO');
    expect(amistoso).toBeDefined();
    // Should NOT pair t1 with t2 (eliminatoria duplicate)
    expect(amistoso![0].equipoLocalId === 't1' && amistoso![0].equipoVisitanteId === 't2').toBe(false);
    expect(amistoso![0].equipoVisitanteId === 't1' && amistoso![0].equipoLocalId === 't2').toBe(false);
  });

  it('no hay suficientes equipos para amistosos → ValidationError', async () => {
    mockDivision({ maxEquipos: 10, diasPartido: null });
    mockPlayoffMode();
    // Only 2 teams total, 1 eliminatoria (t1 vs t2), 1 empty amistoso
    // The only possible pairing t1 vs t2 would duplicate the eliminatoria match
    (prisma.divisionEquipo.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      TEN_TEAMS.slice(0, 2).map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })),
    );
    (partidoRepository.findById as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
      const slot = ELIM_SLOTS.find((s) => s.partidoId === id);
      if (!slot) return null;
      // Only return the first eliminatoria slot
      if (id === 'p2') return null;
      return { id, equipoLocalId: slot.equipoLocalId, equipoVisitanteId: slot.equipoVisitanteId, jornadaId: null };
    });
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await expect(jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'eliminatoria' as const, partidoId: 'p1', equipoLocalId: 't1', equipoVisitanteId: 't2' },
      { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso' },
    ])).rejects.toThrow('No hay combinaciones disponibles');
  });

  it('sin playoff mode, amistoso vacío sigue fallando', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await expect(jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'amistoso' },
    ])).rejects.toThrow('debe tener ambos equipos asignados');
  });

  it('un equipo puede jugar dos amistosos si las parejas son distintas', async () => {
    mockDivision({ maxEquipos: 10, diasPartido: null });
    mockPlayoffMode();
    mockTenTeams();
    mockEliminatoriaPartidos();
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await jornadaService.generateNext(divisionId, [
      ...ELIM_SLOTS,
      { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't5', equipoVisitanteId: 't6' },
      { fecha: '2099-01-01', horaInicio: '01:30', horaFin: '03:00', tipo: 'amistoso', equipoLocalId: 't7', equipoVisitanteId: 't8' },
      { fecha: '2099-01-01', horaInicio: '00:00', horaFin: '01:30', tipo: 'amistoso', equipoLocalId: 't5' },
    ]);

    const amistosos = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls
      .filter(([args]: any[]) => args.tipoPartido === 'AMISTOSO');
    expect(amistosos).toHaveLength(3);
    const t5Matches = amistosos.filter(([args]: any[]) => args.equipoLocalId === 't5' || args.equipoVisitanteId === 't5');
    expect(t5Matches).toHaveLength(2);
    const pairKeys = amistosos.map(([args]: any[]) => [args.equipoLocalId, args.equipoVisitanteId].sort().join('-'));
    expect(new Set(pairKeys).size).toBe(pairKeys.length);
  });

  it('dos amistosos completos pueden repetir equipo con parejas distintas', async () => {
    mockDivision({ maxEquipos: 10, diasPartido: null });
    mockPlayoffMode();
    mockTenTeams();
    mockEliminatoriaPartidos();
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await jornadaService.generateNext(divisionId, [
      ...ELIM_SLOTS,
      { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't5', equipoVisitanteId: 't6' },
      { fecha: '2099-01-01', horaInicio: '01:30', horaFin: '03:00', tipo: 'amistoso', equipoLocalId: 't5', equipoVisitanteId: 't7' },
    ]);
    const amistosos = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls
      .filter(([args]: any[]) => args.tipoPartido === 'AMISTOSO');
    expect(amistosos).toHaveLength(2);
  });

  it('dos amistosos no pueden repetir la misma pareja invertida', async () => {
    mockDivision({ maxEquipos: 10, diasPartido: null });
    mockPlayoffMode();
    mockTenTeams();
    mockEliminatoriaPartidos();
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await expect(jornadaService.generateNext(divisionId, [
      ...ELIM_SLOTS,
      { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't5', equipoVisitanteId: 't6' },
      { fecha: '2099-01-01', horaInicio: '01:30', horaFin: '03:00', tipo: 'amistoso', equipoLocalId: 't6', equipoVisitanteId: 't5' },
    ])).rejects.toThrow('misma pareja');
    expect(partidoRepository.update).not.toHaveBeenCalled();
  });

  it('amistoso manual no permite el mismo equipo en ambos lados', async () => {
    mockDivision({ maxEquipos: 10, diasPartido: null });
    mockPlayoffMode();
    mockTenTeams();
    mockEliminatoriaPartidos();
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await expect(jornadaService.generateNext(divisionId, [
      ...ELIM_SLOTS,
      { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't5', equipoVisitanteId: 't5' },
    ])).rejects.toThrow('contra sí mismo');
  });

  it('amistoso manual rechaza equipos no habilitados', async () => {
    mockDivision({ maxEquipos: 10, diasPartido: null });
    mockPlayoffMode();
    mockTenTeams();
    mockEliminatoriaPartidos();
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await expect(jornadaService.generateNext(divisionId, [
      ...ELIM_SLOTS,
      { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't5', equipoVisitanteId: 'no-habilitado' },
    ])).rejects.toThrow('no está habilitado');
  });

  it('usa el cruce autoritativo de eliminatoria aunque el slot esté desactualizado', async () => {
    mockDivision({ maxEquipos: 10, diasPartido: null });
    mockPlayoffMode();
    mockTenTeams();
    mockEliminatoriaPartidos();
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await expect(jornadaService.generateNext(divisionId, [
      { ...ELIM_SLOTS[0], equipoVisitanteId: 't3' },
      { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2' },
    ])).rejects.toThrow('repite el mismo cruce');
  });

  it('amistosos automáticos no repiten una pareja de la jornada anterior', async () => {
    mockDivision({ maxEquipos: 4, diasPartido: null, duracionPartido: 60 });
    mockPlayoffMode();
    mockTeams(['t1', 't2', 't3', 't4']);
    (jornadaRepository.findByDivision as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{
        numero: 1,
        partidos: [{ equipoLocalId: 't1', equipoVisitanteId: 't2', tipoPartido: 'AMISTOSO' }],
      }],
    });
    mockJornadaCreated(2);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-08', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso' },
    ]);

    const amistoso = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls
      .find(([args]: any[]) => args.tipoPartido === 'AMISTOSO');
    expect(amistoso).toBeDefined();
    expect([amistoso![0].equipoLocalId, amistoso![0].equipoVisitanteId].sort().join('-')).not.toBe('t1-t2');
  });

  it('rechaza un amistoso manual repetido mientras quedan parejas nuevas', async () => {
    mockDivision({ maxEquipos: 4, diasPartido: null, duracionPartido: 60 });
    mockPlayoffMode();
    mockTeams(['t1', 't2', 't3', 't4']);
    (jornadaRepository.findByDivision as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{
        numero: 1,
        partidos: [{ equipoLocalId: 't1', equipoVisitanteId: 't2', tipoPartido: 'AMISTOSO' }],
      }],
    });
    mockJornadaCreated(2);

    await expect(jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-08', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2' },
    ])).rejects.toThrow('todavía hay parejas disponibles');
  });

  it('inicia un nuevo ciclo amistoso después de agotar todas las parejas', async () => {
    mockDivision({ maxEquipos: 4, diasPartido: null, duracionPartido: 60 });
    mockPlayoffMode();
    mockTeams(['t1', 't2', 't3', 't4']);
    const allPairs = [
      ['t1', 't2'], ['t1', 't3'], ['t1', 't4'],
      ['t2', 't3'], ['t2', 't4'], ['t3', 't4'],
    ];
    (jornadaRepository.findByDivision as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{
        numero: 6,
        partidos: allPairs.map(([equipoLocalId, equipoVisitanteId]) => ({ equipoLocalId, equipoVisitanteId, tipoPartido: 'AMISTOSO' })),
      }],
    });
    mockJornadaCreated(7);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-02-01', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso' },
    ]);

    const amistosos = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls
      .filter(([args]: any[]) => args.tipoPartido === 'AMISTOSO');
    expect(amistosos).toHaveLength(1);
  });

  it('propaga un fallo transaccional sin compensaciones ni notificación', async () => {
    mockDivision({ maxEquipos: 10, diasPartido: null });
    mockPlayoffMode();
    mockTenTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();
    (partidoRepository.findById as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
      const slot = ELIM_SLOTS.find((s) => s.partidoId === id)!;
      return {
        id,
        equipoLocalId: slot.equipoLocalId,
        equipoVisitanteId: slot.equipoVisitanteId,
        jornadaId: null,
        fecha: null,
        fechaFin: null,
        canchaId: null,
      };
    });
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('falló transaction'));

    await expect(jornadaService.generateNext(divisionId, [
      ...ELIM_SLOTS,
      { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso' },
    ])).rejects.toThrow('falló transaction');

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.partido.deleteMany).not.toHaveBeenCalled();
    expect(jornadaRepository.delete).not.toHaveBeenCalled();
    expect(prisma.notificationOutbox.createMany).not.toHaveBeenCalled();
  });

  it('recalcula si un partido de playoff deja de estar libre bajo el lock', async () => {
    mockDivision({ maxEquipos: 10, diasPartido: null });
    mockPlayoffMode();
    mockTenTeams();
    mockEliminatoriaPartidos();
    mockNoPreviousJornadas();
    mockJornadaCreated();
    (prisma.partido.updateMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValue({ count: 1 });

    await jornadaService.generateNext(divisionId, ELIM_SLOTS);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.partido.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1', jornadaId: null },
    }));
    expect(prisma.notificationOutbox.createMany).toHaveBeenCalledOnce();
  });
});
