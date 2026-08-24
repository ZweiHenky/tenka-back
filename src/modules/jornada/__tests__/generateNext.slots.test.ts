import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  divisionId, expectMatch, jornadaRepository, jornadaService, mockDivision,
  mockJornadaCreated, mockNoPreviousJornadas, mockPartidosCreatedReturn, mockTeams,
  partidoRepository, prisma, resetGenerateNextHarness, TEAMS,
} from './support/generateNextHarness';

beforeEach(resetGenerateNextHarness);

const capacitySlots = (count: number) => Array.from({ length: count }, (_, index) => ({
  fecha: `2099-02-${String(index + 1).padStart(2, '0')}`,
  horaInicio: '18:00',
  horaFin: '19:30',
}));

describe('generateNext slots', () => {
  it('7 equipos + 1 slot normal completo → slot respetado', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(3);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1', equipoVisitanteId: 't2' },
      ...capacitySlots(2),
    ]);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(3);
    expect(expectMatch(calls, 't1', 't2', 'REGULAR')).toBe(true);
    // t1 and t2 should NOT appear in any other match
    const otherMatches = calls.filter(([args]: any[]) => args.equipoLocalId !== 't1' || args.equipoVisitanteId !== 't2');
    otherMatches.forEach(([args]: any[]) => {
      expect(args.equipoLocalId).not.toBe('t1');
      expect(args.equipoVisitanteId).not.toBe('t1');
      expect(args.equipoLocalId).not.toBe('t2');
      expect(args.equipoVisitanteId).not.toBe('t2');
    });
  });

  it('7 equipos + complemento completo → el equipo Puntos queda fuera del RR', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(4);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento', equipoLocalId: 't4', equipoVisitanteId: 't1' },
      ...capacitySlots(3),
    ]);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    const compMatch = calls.find(([args]: any[]) => args.tipoPartido === 'COMPLEMENTO');
    expect(compMatch).toBeDefined();
    const [compArgs] = compMatch as [any];
    expect(compArgs.tipoPartido).toBe('COMPLEMENTO');
    const regulars = calls.filter(([args]: any[]) => args.tipoPartido === 'REGULAR');
    expect(regulars.every(([args]: any[]) => args.equipoLocalId !== 't4' && args.equipoVisitanteId !== 't4')).toBe(true);
  });

  /**
   * El complemento existe para que un equipo atrasado alcance a los demás, así que el equipo de
   * puntos **puede repetir** — pero solo si lo asignan a mano en los dos sitios. El reparto
   * automático nunca lo hace solo: cuando el equipo de puntos está libre queda reservado y no
   * juega regular, que es lo que fija el test de arriba.
   */
  it('el equipo Puntos también fijado en un regular juega los dos partidos', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(4);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-02', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't4' },
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento', equipoLocalId: 't4', equipoVisitanteId: 't1' },
      ...capacitySlots(3),
    ]);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    const enComplemento = calls.filter(([args]: any[]) => args.tipoPartido === 'COMPLEMENTO' && args.equipoLocalId === 't4');
    const enRegular = calls.filter(([args]: any[]) => args.tipoPartido === 'REGULAR' && (args.equipoLocalId === 't4' || args.equipoVisitanteId === 't4'));

    expect(enComplemento).toHaveLength(1);
    expect(enRegular).toHaveLength(1);
  });

  it('el mismo equipo puede ganar puntos en varios complementos', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(5);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento', equipoLocalId: 't4', equipoVisitanteId: 't1' },
      { fecha: '2099-01-01', horaInicio: '20:00', horaFin: '21:30', tipo: 'complemento', equipoLocalId: 't4', equipoVisitanteId: 't2' },
      ...capacitySlots(3),
    ]);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    const complementos = calls.filter(([args]: any[]) => args.tipoPartido === 'COMPLEMENTO');

    expect(complementos).toHaveLength(2);
    expect(complementos.every(([args]: any[]) => args.equipoLocalId === 't4')).toBe(true);
  });

  it('complemento vacío → ValidationError', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await expect(jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento' },
    ])).rejects.toThrow('Asigna ambos equipos del partido de complemento');
  });

  it('complemento sin equipo Sin puntos → ValidationError específico', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();

    await expect(jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento', equipoLocalId: 't7' },
    ])).rejects.toThrow('Asigna el equipo que repetirá partido sin puntos en el complemento');
  });

  it('selección impar usa complemento completo en lugar de descanso', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await jornadaService.generateNextWithSelection([
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento', equipoLocalId: 't7', equipoVisitanteId: 't1' },
      ...capacitySlots(3),
    ], TEAMS.map((team) => team.id));

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.filter(([args]: any[]) => args.tipoPartido === 'REGULAR')).toHaveLength(3);
    expect(calls.filter(([args]: any[]) => args.tipoPartido === 'COMPLEMENTO')).toHaveLength(1);
    expect(calls.filter(([args]: any[]) => args.tipoPartido === 'REGULAR').every(([args]: any[]) => args.equipoLocalId !== 't7' && args.equipoVisitanteId !== 't7')).toBe(true);
  });

  it('rechaza combinar complemento y descanso', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();

    await expect(jornadaService.generateNextWithSelection([
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento', equipoLocalId: 't7', equipoVisitanteId: 't1' },
      ...capacitySlots(3),
    ], TEAMS.map((team) => team.id), 't6')).rejects.toThrow('No se puede combinar un partido de complemento');
  });

  it('amistoso sin equipos → ValidationError', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await expect(jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'amistoso' },
    ])).rejects.toThrow('debe tener ambos equipos asignados');
  });

  it('amistoso con un solo equipo → ValidationError', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await expect(jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'amistoso', equipoLocalId: 't1' },
    ])).rejects.toThrow('debe tener ambos equipos asignados');
  });

  it('mismo equipo en 2 slots normales → ValidationError', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();

    await expect(jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1', equipoVisitanteId: 't2' },
      { fecha: '2099-01-01', horaInicio: '19:30', horaFin: '21:00', equipoLocalId: 't1', equipoVisitanteId: 't3' },
    ])).rejects.toThrow('ya está asignado a otro horario');
  });

  it('equipo Sin puntos puede repetir un partido regular', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(4);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1', equipoVisitanteId: 't2' },
      { fecha: '2099-01-01', horaInicio: '19:30', horaFin: '21:00', tipo: 'complemento', equipoLocalId: 't3', equipoVisitanteId: 't1' },
      ...capacitySlots(2),
    ]);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    const compMatch = calls.find(([args]: any[]) => args.tipoPartido === 'COMPLEMENTO');
    expect(compMatch).toBeDefined();
  });

  it('más pairings que slots físicos → ValidationError', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(4);

    await expect(jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1', equipoVisitanteId: 't2' },
      { fecha: '2099-01-01', horaInicio: '19:30', horaFin: '21:00', tipo: 'complemento', equipoLocalId: 't3', equipoVisitanteId: 't1' },
    ])).rejects.toThrow('No hay suficientes slots físicos');
  });

  it('flags correctos: Puntos en complemento suma, Sin puntos no suma', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(4);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento', equipoLocalId: 't4', equipoVisitanteId: 't1' },
      ...capacitySlots(3),
    ]);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    const compMatch = calls.find(([args]: any[]) => args.tipoPartido === 'COMPLEMENTO');
    expect(compMatch).toBeDefined();

    const [compArgs] = compMatch as [any];
    expect(compArgs.tipoPartido).toBe('COMPLEMENTO');
  });

  it('complemento con ambos equipos asignados → Puntos y Sin puntos preservan tipo', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(4);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento', equipoLocalId: 't4', equipoVisitanteId: 't5' },
      ...capacitySlots(3),
    ]);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    const comp = calls.find(([args]: any[]) => args.tipoPartido === 'COMPLEMENTO' && args.equipoLocalId === 't4' && args.equipoVisitanteId === 't5');
    expect(comp).toBeDefined();
    const [compArgs] = comp as [any];
    expect(compArgs.tipoPartido).toBe('COMPLEMENTO');
  });

  it('2 complementos con 1 equipo cada uno → excluye del RR, flags correctos', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(4);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento', equipoLocalId: 't4', equipoVisitanteId: 't1' },
      { fecha: '2099-01-01', horaInicio: '19:30', horaFin: '21:00', tipo: 'complemento', equipoLocalId: 't5', equipoVisitanteId: 't2' },
      ...capacitySlots(3),
    ]);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    const complementos = calls.filter(([args]: any[]) => args.tipoPartido === 'COMPLEMENTO');
    expect(complementos).toHaveLength(2);
  });

  it('slots=[] (array vacío) → mismo que undefined', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(3);

    await jornadaService.generateNext(divisionId, []);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(3);
  });

  it('slot parcial con historial previo → no repite el mismo rival de J1', async () => {
    mockDivision({ maxEquipos: 6, diasPartido: null });
    const sixTeams = TEAMS.slice(0, 6);
    (prisma.divisionEquipo.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      sixTeams.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })),
    );
    // J1 had t1 vs t2
    (jornadaRepository.findByDivision as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{
        numero: 1,
        partidos: [{
          equipoLocalId: 't1',
          equipoVisitanteId: 't2',
          tipoPartido: 'REGULAR',
        }],
      }],
    });
    mockJornadaCreated(2);
    mockPartidosCreatedReturn(3);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-08', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1' },
      ...capacitySlots(2),
    ]);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(3);
    const t1Match = calls.find(([args]: any[]) => args.equipoLocalId === 't1' || args.equipoVisitanteId === 't1');
    expect(t1Match).toBeDefined();
    const [t1Args] = t1Match as [any];
    // Should NOT face t2 again
    const opponent = t1Args.equipoLocalId === 't1' ? t1Args.equipoVisitanteId : t1Args.equipoLocalId;
    expect(opponent).not.toBe('t2');
  });

  it('slot parcial visitante con historial → no repite rival', async () => {
    mockDivision({ maxEquipos: 6, diasPartido: null });
    const sixTeams = TEAMS.slice(0, 6);
    (prisma.divisionEquipo.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      sixTeams.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })),
    );
    // J1 had t2 vs t1 (reverse orientation)
    (jornadaRepository.findByDivision as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{
        numero: 1,
        partidos: [{
          equipoLocalId: 't2',
          equipoVisitanteId: 't1',
          tipoPartido: 'REGULAR',
        }],
      }],
    });
    mockJornadaCreated(2);
    mockPartidosCreatedReturn(3);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-08', horaInicio: '18:00', horaFin: '19:30', equipoVisitanteId: 't1' },
      ...capacitySlots(2),
    ]);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(3);
    const t1Match = calls.find(([args]: any[]) => args.equipoLocalId === 't1' || args.equipoVisitanteId === 't1');
    expect(t1Match).toBeDefined();
    const [t1Args] = t1Match as [any];
    const opponent = t1Args.equipoLocalId === 't1' ? t1Args.equipoVisitanteId : t1Args.equipoLocalId;
    expect(opponent).not.toBe('t2');
  });

  it('slot normal parcial (solo local) → se llena del pool', async () => {
    mockDivision();
    mockTeams();
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(3);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1' },
      ...capacitySlots(2),
    ]);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(3);
    const matchWithT1 = calls.find(([args]: any[]) => args.equipoLocalId === 't1' || args.equipoVisitanteId === 't1');
    expect(matchWithT1).toBeDefined();
    // t1 should not be in any other match
    const t1Count = calls.filter(([args]: any[]) => args.equipoLocalId === 't1' || args.equipoVisitanteId === 't1').length;
    expect(t1Count).toBe(1);
  });

  it('mixed jornada: regular + amistoso + complemento, each preserves tipoPartido', async () => {
    const sixTeams = TEAMS.slice(0, 6);
    mockDivision({ maxEquipos: 6, diasPartido: null });
    (prisma.divisionEquipo.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      sixTeams.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })),
    );
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(5);

    await jornadaService.generateNext(divisionId, [
      { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1', equipoVisitanteId: 't2' },
      { fecha: '2099-01-01', horaInicio: '19:30', horaFin: '21:00', tipo: 'amistoso', equipoLocalId: 't3', equipoVisitanteId: 't4' },
      { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'complemento', equipoLocalId: 't5', equipoVisitanteId: 't6' },
      ...capacitySlots(2),
    ]);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(4);

    const regular = calls.find(([args]: any[]) => args.equipoLocalId === 't1' && args.equipoVisitanteId === 't2');
    expect(regular).toBeDefined();
    expect(regular![0].tipoPartido).toBe('REGULAR');

    const amistoso = calls.find(([args]: any[]) => args.tipoPartido === 'AMISTOSO');
    expect(amistoso).toBeDefined();
    expect(amistoso![0].tipoPartido).toBe('AMISTOSO');

    const complemento = calls.find(([args]: any[]) => args.tipoPartido === 'COMPLEMENTO');
    expect(complemento).toBeDefined();
    expect(complemento![0].tipoPartido).toBe('COMPLEMENTO');
  });
});
