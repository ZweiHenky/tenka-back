import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  jornadaFindFirst: vi.fn(),
  jornadaUpdate: vi.fn(),
}));

vi.mock('../../../config/database', () => ({
  prisma: {
    jornada: {
      findFirst: mocks.jornadaFindFirst,
      update: mocks.jornadaUpdate,
    },
  },
}));

vi.mock('../../partido/repository', () => ({ partidoRepository: {} }));
vi.mock('../../tabla-posicion/service', () => ({ tablaPosicionService: {} }));
vi.mock('../../notification/service', () => ({ notificationService: {} }));

import { jornadaRepository } from '../repository';
import { jornadaService } from '../service';
import type { AuthenticatedUser } from '../../../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('jornada private contexts', () => {
  it('updates with one narrow authorization query and preserves the update response', async () => {
    const updated = { id: 'j-1', numero: 4, divisionId: 'd-1' };
    mocks.jornadaFindFirst.mockResolvedValue({ id: 'j-1' });
    mocks.jornadaUpdate.mockResolvedValue(updated);

    await expect(jornadaService.update('j-1', { numero: 4 }, owner)).resolves.toBe(updated);

    expect(mocks.jornadaFindFirst).toHaveBeenCalledOnce();
    expect(mocks.jornadaFindFirst).toHaveBeenCalledWith({
      where: { id: 'j-1', division: { liga: { userId: 'owner-1' } } },
      select: { id: true },
    });
    expect(mocks.jornadaUpdate).toHaveBeenCalledOnce();
  });

  it('returns 404 and does not update when ownership filtering finds no jornada', async () => {
    mocks.jornadaFindFirst.mockResolvedValue(null);

    await expect(jornadaService.update('hidden', { numero: 4 }, owner)).rejects.toMatchObject({ statusCode: 404 });

    expect(mocks.jornadaUpdate).not.toHaveBeenCalled();
  });

  it('allows an admin context lookup without an owner predicate', async () => {
    mocks.jornadaFindFirst.mockResolvedValue({ id: 'j-1' });

    await jornadaRepository.findUpdateContext('j-1', admin);

    expect(mocks.jornadaFindFirst).toHaveBeenCalledWith({
      where: { id: 'j-1' },
      select: { id: true },
    });
  });

  it('loads deletion authorization, latest ID, and repair fields in one narrow query', async () => {
    mocks.jornadaFindFirst.mockResolvedValue({
      divisionId: 'd-1',
      division: { jornadas: [{ id: 'j-2' }] },
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
      latestJornadaId: 'j-2',
      hasFinalizados: true,
      playoffPartidos: [{ id: 'playoff', rondaPlayoffId: 'r-1', llave: 2 }],
    });
  });
});
