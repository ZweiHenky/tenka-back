import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  jornadaFindUnique: vi.fn(),
  ligaCanchaFindMany: vi.fn(),
  partidoFindMany: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  prisma: {
    jornada: { findUnique: mocks.jornadaFindUnique },
    ligaCancha: { findMany: mocks.ligaCanchaFindMany },
    partido: { findMany: mocks.partidoFindMany },
  },
}));

import { jornadaPartidoCreationService } from './jornadaCreation';
import type { AuthenticatedUser } from '../../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };

// Far enough in the future that configuredCandidates never filters a slot out for being past.
const FECHA_INICIO = new Date('2099-01-01T00:00:00.000Z');
const FECHA_FIN = new Date('2099-01-07T23:59:59.000Z');

function mockJornada(opts: {
  canchaHorarios?: Array<{ canchaId: string; diasPartido: string; horarioPartido: string }>;
  diasPartido?: string | null;
  horarioPartido?: string | null;
  multiplesCanchas?: boolean;
}) {
  mocks.jornadaFindUnique.mockResolvedValue({
    id: 'jornada-1',
    fechaInicio: FECHA_INICIO,
    fechaFin: FECHA_FIN,
    division: {
      id: 'division-1',
      ligaId: 'liga-1',
      diasPartido: opts.diasPartido ?? null,
      horarioPartido: opts.horarioPartido ?? null,
      duracionPartido: 60,
      descanso: 0,
      canchaHorarios: opts.canchaHorarios ?? [],
      estadoLiga: { nombre: 'En Curso' },
      liga: { userId: owner.id, multiplesCanchas: opts.multiplesCanchas ?? true, timeZone: 'UTC' },
      equipos: [
        { equipo: { id: 't1', nombre: 'Equipo 1' } },
        { equipo: { id: 't2', nombre: 'Equipo 2' } },
      ],
    },
    partidos: [],
  });
}

describe('creation-options con horario por cancha', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ligaCanchaFindMany.mockResolvedValue([
      { id: 'c1', nombre: 'Cancha 1' },
      { id: 'c2', nombre: 'Cancha 2' },
    ]);
    mocks.partidoFindMany.mockResolvedValue([]);
  });

  it('genera los horarios de cada cancha por separado', async () => {
    mockJornada({
      canchaHorarios: [
        { canchaId: 'c1', diasPartido: 'lun', horarioPartido: '18:00 - 20:00' },
        { canchaId: 'c2', diasPartido: 'mar', horarioPartido: '08:00 - 09:00' },
      ],
    });

    const { slots } = await jornadaPartidoCreationService.getOptions('jornada-1', owner);

    const c1 = slots.filter((slot) => slot.canchaId === 'c1');
    const c2 = slots.filter((slot) => slot.canchaId === 'c2');
    // c1: Monday 18:00 and 19:00. c2: Tuesday 08:00 only.
    expect(c1.map((s) => `${s.fecha} ${s.horaInicio}`)).toEqual(['2098-12-29 18:00', '2098-12-29 19:00']);
    expect(c2.map((s) => `${s.fecha} ${s.horaInicio}`)).toEqual(['2098-12-30 08:00']);
  });

  it('no produce slots para una cancha sin horario configurado', async () => {
    mockJornada({ canchaHorarios: [{ canchaId: 'c1', diasPartido: 'lun', horarioPartido: '18:00 - 20:00' }] });

    const { slots } = await jornadaPartidoCreationService.getOptions('jornada-1', owner);

    expect(slots.some((slot) => slot.canchaId === 'c2')).toBe(false);
    expect(slots.length).toBeGreaterThan(0);
  });

  it('ordena por fecha, hora y cancha', async () => {
    mockJornada({
      canchaHorarios: [
        { canchaId: 'c2', diasPartido: 'lun', horarioPartido: '18:00 - 19:00' },
        { canchaId: 'c1', diasPartido: 'lun', horarioPartido: '18:00 - 19:00' },
      ],
    });

    const { slots } = await jornadaPartidoCreationService.getOptions('jornada-1', owner);

    expect(slots.map((slot) => slot.canchaNombre)).toEqual(['Cancha 1', 'Cancha 2']);
  });

  it('sin filas replica los escalares en todas las canchas, como antes', async () => {
    mockJornada({ diasPartido: 'lun', horarioPartido: '18:00 - 19:00' });

    const { slots } = await jornadaPartidoCreationService.getOptions('jornada-1', owner);

    expect(slots.map((slot) => slot.canchaId).sort()).toEqual(['c1', 'c2']);
  });

  it('falla claro cuando ninguna cancha tiene horario', async () => {
    mockJornada({ canchaHorarios: [{ canchaId: 'inactiva', diasPartido: 'lun', horarioPartido: '18:00 - 19:00' }] });

    await expect(jornadaPartidoCreationService.getOptions('jornada-1', owner))
      .rejects.toThrow('no tiene canchas con horario configurado');
  });
});
