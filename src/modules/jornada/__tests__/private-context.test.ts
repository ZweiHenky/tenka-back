import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  jornadaFindFirst: vi.fn(),
}));

vi.mock('../../../config/database', () => ({
  prisma: {
    jornada: {
      findFirst: mocks.jornadaFindFirst,
    },
  },
}));

vi.mock('../../partido/repository', () => ({ partidoRepository: {} }));
vi.mock('../../tabla-posicion/service', () => ({ tablaPosicionService: {} }));
vi.mock('../../notification/service', () => ({ notificationService: {} }));

import { jornadaRepository } from '../repository';
import type { AuthenticatedUser } from '../../../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('jornada private contexts', () => {
  it('loads deletion authorization, latest ID, and repair fields in one narrow query', async () => {
    mocks.jornadaFindFirst.mockResolvedValue({
      divisionId: 'd-1',
      division: { ligaId: 'liga-1', liga: { userId: 'owner-1' }, jornadas: [{ id: 'j-2' }] },
      partidos: [
        { id: 'regular-final', estado: 'FINALIZADO', rondaPlayoffId: null, llave: null },
        { id: 'playoff', estado: 'PROGRAMADO', rondaPlayoffId: 'r-1', llave: 2 },
      ],
    });

    const result = await jornadaRepository.findDeleteContext('j-2', owner);

    expect(mocks.jornadaFindFirst).toHaveBeenCalledOnce();
    expect(mocks.jornadaFindFirst).toHaveBeenCalledWith({
      where: { id: 'j-2', division: { liga: { userId: 'owner-1' } } },
      select: {
        divisionId: true,
        division: {
          select: {
            ligaId: true,
            estadoLiga: { select: { codigo: true } },
            liga: { select: { userId: true } },
            jornadas: { orderBy: { numero: 'desc' }, take: 1, select: { id: true } },
          },
        },
        partidos: {
          where: {
            OR: [
              { estado: 'FINALIZADO' },
              { rondaPlayoffId: { not: null }, llave: { not: null } },
            ],
          },
          select: { id: true, estado: true, rondaPlayoffId: true, llave: true },
        },
      },
    });
    expect(result).toEqual({
      divisionId: 'd-1',
      ligaId: 'liga-1',
      ligaUserId: 'owner-1',
      latestJornadaId: 'j-2',
      hasFinalizados: true,
      playoffPartidos: [{ id: 'playoff', rondaPlayoffId: 'r-1', llave: 2 }],
    });
  });

  it('uses the supplied transaction client for the authoritative deletion context', async () => {
    const transactionFindFirst = vi.fn().mockResolvedValue(null);
    const tx = { jornada: { findFirst: transactionFindFirst } } as any;

    await jornadaRepository.findDeleteContext('j-2', owner, tx);

    expect(transactionFindFirst).toHaveBeenCalledOnce();
    expect(mocks.jornadaFindFirst).not.toHaveBeenCalled();
  });
});
