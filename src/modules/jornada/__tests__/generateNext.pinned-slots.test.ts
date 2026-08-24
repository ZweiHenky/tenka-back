import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  divisionId, jornadaService, mockDivision, mockJornadaCreated,
  mockNoPreviousJornadas, mockPartidosCreatedReturn, mockTeams, partidoRepository,
  resetGenerateNextHarness,
} from './support/generateNextHarness';

beforeEach(resetGenerateNextHarness);

const vacio = (dia: number) => ({
  fecha: `2099-02-${String(dia).padStart(2, '0')}`,
  horaInicio: '18:00',
  horaFin: '19:30',
});

/**
 * El reparto de equipos a slots se hace en dos pasadas: primero los slots que ya traen un equipo
 * puesto a mano, después los vacíos.
 *
 * En una sola pasada un slot vacío anterior tomaba "el primer equipo sin partido" y podía llevarse
 * al equipo fijado en un slot posterior junto con su rival. Al llegar a ese slot se rearmaba la
 * misma pareja y el filtro de duplicados la descartaba: la jornada salía con un partido menos y dos
 * equipos habilitados sin jugar, **sin ningún error**.
 */
describe('generateNext con equipos fijados a mano', () => {
  it('un equipo fijado en el último slot no se lo roba un slot vacío anterior', async () => {
    mockDivision({ maxEquipos: 6, diasPartido: null });
    mockTeams(['t1', 't2', 't3', 't4', 't5', 't6']);
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(3);

    await jornadaService.generateNext(divisionId, [
      { ...vacio(1), equipoLocalId: 't1' },
      vacio(2),
      { ...vacio(3), equipoLocalId: 't6' },
    ]);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;

    // Los tres slots producen partido: ninguno se pierde por pareja duplicada.
    expect(calls.length).toBe(3);

    // Y los seis equipos juegan exactamente una vez.
    const jugaron = calls.flatMap(([args]: any[]) => [args.equipoLocalId, args.equipoVisitanteId]);
    expect(jugaron.filter(Boolean).sort()).toEqual(['t1', 't2', 't3', 't4', 't5', 't6']);
  });

  it('respeta el equipo fijado en cada extremo', async () => {
    mockDivision({ maxEquipos: 6, diasPartido: null });
    mockTeams(['t1', 't2', 't3', 't4', 't5', 't6']);
    mockNoPreviousJornadas();
    mockJornadaCreated();
    mockPartidosCreatedReturn(3);

    await jornadaService.generateNext(divisionId, [
      { ...vacio(1), equipoLocalId: 't1' },
      vacio(2),
      { ...vacio(3), equipoLocalId: 't6' },
    ]);

    const calls = (partidoRepository.create as ReturnType<typeof vi.fn>).mock.calls;
    const porDia = new Map(calls.map(([args]: any[]) => [new Date(args.fecha).getDate(), args]));

    expect(porDia.get(1)?.equipoLocalId).toBe('t1');
    expect(porDia.get(3)?.equipoLocalId).toBe('t6');
  });
});
