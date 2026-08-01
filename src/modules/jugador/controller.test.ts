import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const mocks = vi.hoisted(() => ({ divisionFindFirst: vi.fn() }));

vi.mock('../../config/database', () => ({
  prisma: { division: { findFirst: mocks.divisionFindFirst } },
}));

vi.mock('../media/service', () => ({
  mediaService: { scheduleImageCleanup: vi.fn() },
}));

import { jugadorController } from './controller';
import type { AuthenticatedUser } from '../../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };

function request(actor?: AuthenticatedUser) {
  return { params: { divisionId: 'division-1', equipoId: 'team-1' }, user: actor } as unknown as Request;
}

function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
}

describe('jugadorController.listByDivisionTeam', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [undefined, { estadoLiga: { nombre: { not: 'Borrador' } } }],
    [owner, { OR: [
      { estadoLiga: { nombre: { not: 'Borrador' } } },
      { liga: { userId: owner.id } },
    ] }],
    [admin, {}],
  ])('retrieves the roster from one visible parent for actor %#', async (actor, visibility) => {
    mocks.divisionFindFirst.mockResolvedValue({ jugadores: [] });
    const res = response();
    const next = vi.fn() as NextFunction;

    await jugadorController.listByDivisionTeam(request(actor), res, next);

    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.divisionFindFirst).toHaveBeenCalledWith({
      where: { id: 'division-1', ...visibility },
      select: {
        jugadores: {
          where: { equipoId: 'team-1' },
          include: { jugador: true },
          orderBy: { jugador: { nombre: 'asc' } },
        },
      },
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 through error handling for a hidden or missing division', async () => {
    mocks.divisionFindFirst.mockResolvedValue(null);
    const next = vi.fn() as NextFunction;

    await jugadorController.listByDivisionTeam(request(), response(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 404, message: 'División no encontrado',
    }));
    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
  });

  it('sanitizes the public roster without an additional operation', async () => {
    mocks.divisionFindFirst.mockResolvedValue({
      jugadores: [{
        divisionId: 'division-1', equipoId: 'team-1', jugadorId: 'player-1',
        jugador: {
          id: 'player-1', nombre: 'Player', telefono: '555', userId: 'user-1',
          fotoPublicId: 'private-id', showPhoneInPublicProfile: false,
        },
      }],
    });
    const res = response();

    await jugadorController.listByDivisionTeam(request(), res, vi.fn());

    expect(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [expect.objectContaining({
      jugador: expect.objectContaining({ telefono: null, userId: undefined, fotoPublicId: undefined }),
    })] });
  });
});
