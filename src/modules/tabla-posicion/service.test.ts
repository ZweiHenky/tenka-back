import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findByDivision: vi.fn(), findTeamsByDivision: vi.fn(), findOne: vi.fn() }));

vi.mock('./repository', () => ({
  tablaPosicionRepository: {
    findByDivision: mocks.findByDivision,
    findTeamsByDivision: mocks.findTeamsByDivision,
    findOne: mocks.findOne,
  },
}));

vi.mock('../../config/database', () => ({ prisma: {} }));

import { tablaPosicionService } from './service';

const team = { id: 'team-1', nombre: 'Team One', logo: null };
const row = {
  id: 'standing-1', partidosJugados: 1, ganados: 1, empatados: 0, perdidos: 0,
  golesFavor: 2, golesContra: 0, diferenciaGoles: 2, puntos: 3,
  divisionId: 'division-1', equipoId: 'team-1', equipo: team,
};

describe('tablaPosicionService public reads', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns persisted standings with one operation', async () => {
    mocks.findByDivision.mockResolvedValue({ tablaPosiciones: [row] });

    await expect(tablaPosicionService.findByDivision('division-1')).resolves.toEqual([row]);
    expect(mocks.findByDivision).toHaveBeenCalledTimes(1);
    expect(mocks.findTeamsByDivision).not.toHaveBeenCalled();
  });

  it('preserves placeholders when a visible division has teams but no standings', async () => {
    mocks.findByDivision.mockResolvedValue({ tablaPosiciones: [] });
    mocks.findTeamsByDivision.mockResolvedValue({
      equipos: [{ equipoId: 'team-1', equipo: team }],
    });

    await expect(tablaPosicionService.findByDivision('division-1')).resolves.toEqual([{
      id: 'placeholder-team-1', partidosJugados: 0, ganados: 0, empatados: 0,
      perdidos: 0, golesFavor: 0, golesContra: 0, diferenciaGoles: 0, puntos: 0,
      divisionId: 'division-1', equipoId: 'team-1', equipo: team,
    }]);
    expect(mocks.findByDivision).toHaveBeenCalledTimes(1);
  });

  it('returns empty for a visible division without standings or teams', async () => {
    mocks.findByDivision.mockResolvedValue({ tablaPosiciones: [] });
    mocks.findTeamsByDivision.mockResolvedValue({ equipos: [] });
    await expect(tablaPosicionService.findByDivision('division-1')).resolves.toEqual([]);
  });

  it('returns division 404 for a hidden or missing division', async () => {
    mocks.findByDivision.mockResolvedValue(null);
    await expect(tablaPosicionService.findByDivision('division-1')).rejects.toMatchObject({
      statusCode: 404, message: 'División no encontrado',
    });
  });

  it('distinguishes a hidden division from a visible division without the requested standing', async () => {
    mocks.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ tablaPosiciones: [] });

    await expect(tablaPosicionService.findOne('hidden', 'team-1')).rejects.toMatchObject({
      statusCode: 404, message: 'División no encontrado',
    });
    await expect(tablaPosicionService.findOne('visible', 'team-1')).rejects.toMatchObject({
      statusCode: 404, message: 'Posición no encontrado',
    });
    expect(mocks.findOne).toHaveBeenCalledTimes(2);
  });

  it('returns one standing with one operation', async () => {
    mocks.findOne.mockResolvedValue({ tablaPosiciones: [row] });
    await expect(tablaPosicionService.findOne('division-1', 'team-1')).resolves.toBe(row);
    expect(mocks.findOne).toHaveBeenCalledTimes(1);
  });
});
