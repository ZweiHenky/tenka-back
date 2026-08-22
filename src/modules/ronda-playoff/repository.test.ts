import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rondaFindFirst: vi.fn(),
  divisionFindFirst: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  prisma: {
    rondaPlayoff: { findFirst: mocks.rondaFindFirst },
    division: { findFirst: mocks.divisionFindFirst },
  },
}));

import { rondaPlayoffRepository } from './repository';
import type { AuthenticatedUser } from '../../types/auth';

const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };

describe('rondaPlayoffRepository public reads', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gets a round with embedded division visibility in one query', async () => {
    const ronda = { id: 'ronda-1', divisionId: 'division-1' };
    mocks.rondaFindFirst.mockResolvedValue(ronda);

    await expect(rondaPlayoffRepository.findVisibleById('ronda-1', admin)).resolves.toBe(ronda);
    expect(mocks.rondaFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.rondaFindFirst).toHaveBeenCalledWith({
      where: { id: 'ronda-1', division: {} },
    });
  });

  it('loads ordered rounds through one visible parent query', async () => {
    const partido = {
      id: 'partido-1',
      equipoLocal: { id: 'local-1', nombre: 'Local', logo: null },
      equipoVisitante: { id: 'visitante-1', nombre: 'Visitante', logo: null },
      cancha: { id: 'cancha-1', nombre: 'Central' },
      arbitros: [{ arbitro: { id: 'arbitro-1', nombre: 'Alex' } }],
    };
    const rondasPlayoff = [{ id: 'ronda-1', partidos: [partido] }, { id: 'ronda-2', partidos: [] }];
    mocks.divisionFindFirst.mockResolvedValue({ rondasPlayoff });

    await expect(rondaPlayoffRepository.findVisibleByDivision('division-1')).resolves.toEqual([
      { id: 'ronda-1', partidos: [{ ...partido, arbitros: [{ id: 'arbitro-1', nombre: 'Alex' }] }] },
      { id: 'ronda-2', partidos: [] },
    ]);
    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.divisionFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'division-1',
        estadoLiga: { codigo: { not: 'BORRADOR' } },
      },
      select: {
        rondasPlayoff: {
          orderBy: { orden: 'asc' },
          // Los partidos también van ordenados: sin esto salían en el orden físico de Postgres,
          // que no es ninguno, y la pestaña Eliminatoria los pintaba salteados.
          include: {
            partidos: {
              orderBy: [{ fecha: 'asc' }, { llave: 'asc' }],
              include: expect.any(Object),
            },
          },
        },
      },
    });
  });

  it('distinguishes a visible empty division from a hidden or missing division', async () => {
    mocks.divisionFindFirst.mockResolvedValueOnce({ rondasPlayoff: [] }).mockResolvedValueOnce(null);

    await expect(rondaPlayoffRepository.findVisibleByDivision('visible')).resolves.toEqual([]);
    await expect(rondaPlayoffRepository.findVisibleByDivision('hidden-or-missing')).resolves.toBeNull();
  });
});
