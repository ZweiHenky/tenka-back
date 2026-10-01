import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  divisionFindFirst: vi.fn(),
  equipoFindUnique: vi.fn(),
  jugadorFindFirst: vi.fn(),
  jugadorFindUnique: vi.fn(),
  jugadorFindUniqueOrThrow: vi.fn(),
  membershipFindUnique: vi.fn(),
  membershipCreate: vi.fn(),
  membershipUpdate: vi.fn(),
  divisionEquipoFindUnique: vi.fn(),
  divisionJugadorCreate: vi.fn(),
  divisionJugadorDelete: vi.fn(),
  divisionJugadorUpdateMany: vi.fn(),
  mediaLock: vi.fn(),
  mediaPrepare: vi.fn(),
  resourceAccessObserveInTransaction: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  prisma: {
    division: { findFirst: mocks.divisionFindFirst },
    equipo: { findUnique: mocks.equipoFindUnique },
    jugador: { findFirst: mocks.jugadorFindFirst, findUnique: mocks.jugadorFindUnique, findUniqueOrThrow: mocks.jugadorFindUniqueOrThrow },
    equipoJugador: { findUnique: mocks.membershipFindUnique, create: mocks.membershipCreate, update: mocks.membershipUpdate },
    divisionEquipo: { findUnique: mocks.divisionEquipoFindUnique },
    divisionJugador: { create: mocks.divisionJugadorCreate, delete: mocks.divisionJugadorDelete, updateMany: mocks.divisionJugadorUpdateMany },
    $transaction: mocks.transaction,
  },
}));

vi.mock('../media/service', () => ({
  mediaService: { scheduleImageCleanup: vi.fn(), lockAttachmentTarget: mocks.mediaLock, prepareAttachment: mocks.mediaPrepare },
}));

vi.mock('../billing/resourceAccessShadow', () => ({
  observeResourceAccessShadowInTransaction: mocks.resourceAccessObserveInTransaction,
}));

import { jugadorController } from './controller';
import type { AuthenticatedUser } from '../../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };

function request(actor?: AuthenticatedUser) {
  return { params: { divisionId: 'division-1', equipoId: 'team-1' }, user: actor } as unknown as Request;
}

function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), end: vi.fn() } as unknown as Response;
}

describe('jugadorController.listByDivisionTeam', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [undefined, { estadoLiga: { codigo: { not: 'BORRADOR' } } }],
    [owner, { OR: [
      { estadoLiga: { codigo: { not: 'BORRADOR' } } },
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

describe('jugadorController.lookupByPhone', () => {
  beforeEach(() => vi.clearAllMocks());

  function lookupRequest(actor = owner, telefono: unknown = '+5215512345678', equipoId = 'team-1') {
    return { params: { equipoId }, body: { telefono }, user: actor } as unknown as Request;
  }

  it('rejects a non-canonical E.164 phone before ownership or lookup queries', async () => {
    const next = vi.fn() as NextFunction;

    await jugadorController.lookupByPhone(lookupRequest(owner, '521 55 1234 5678'), response(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
    expect(mocks.equipoFindUnique).not.toHaveBeenCalled();
    expect(mocks.jugadorFindFirst).not.toHaveBeenCalled();
  });

  it('hides a foreign team while allowing its owner or an admin', async () => {
    mocks.equipoFindUnique.mockResolvedValue({ userId: 'owner-1' });
    mocks.jugadorFindFirst.mockResolvedValue(null);
    const foreign = { id: 'other-1', email: 'other@test.com', rol: 'CAPITAN' as const };
    const foreignNext = vi.fn() as NextFunction;

    await jugadorController.lookupByPhone(lookupRequest(foreign), response(), foreignNext);
    await jugadorController.lookupByPhone(lookupRequest(owner), response(), vi.fn());
    await jugadorController.lookupByPhone(lookupRequest(admin), response(), vi.fn());

    expect(foreignNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404, message: 'Equipo no encontrado' }));
    expect(mocks.jugadorFindFirst).toHaveBeenCalledTimes(2);
  });

  it('searches by the linked account verified phone without relying on the legacy player phone', async () => {
    mocks.equipoFindUnique.mockResolvedValue({ userId: owner.id });
    mocks.jugadorFindFirst.mockResolvedValue(null);
    const next = vi.fn() as NextFunction;

    await jugadorController.lookupByPhone(lookupRequest(), response(), next);

    expect(mocks.jugadorFindFirst).toHaveBeenCalledWith({
      where: {
        user: { is: { phoneNumber: '+5215512345678', phoneNumberVerified: true } },
      },
      select: {
        id: true, nombre: true, foto: true, posicion: true,
        equipos: { where: { equipoId: 'team-1' }, select: { dorsal: true }, take: 1 },
      },
    });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 404,
      message: 'No encontramos un perfil de jugador con este teléfono',
    }));
  });

  it.each([
    [[], false, null],
    [[{ dorsal: 10 }], true, 10],
  ])('returns only the purpose DTO (membership %#)', async (equipos, yaPertenece, dorsal) => {
    mocks.equipoFindUnique.mockResolvedValue({ userId: owner.id });
    mocks.jugadorFindFirst.mockResolvedValue({
      id: 'player-1', nombre: 'Player', foto: 'photo-url', posicion: 'MEDIO', equipos,
      telefono: '+5215512345678', userId: 'user-1', edad: 20, fotoPublicId: 'secret',
    });
    const res = response();

    await jugadorController.lookupByPhone(lookupRequest(), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({ success: true, data: {
      id: 'player-1', nombre: 'Player', foto: 'photo-url', posicion: 'MEDIO', yaPertenece, dorsal,
    } });
  });
});

describe('jugadorController.assignToTeam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.equipoFindUnique.mockResolvedValue({ userId: owner.id });
    mocks.transaction.mockImplementation((work) => work({
      jugador: { findUnique: mocks.jugadorFindUnique },
      equipoJugador: { findUnique: mocks.membershipFindUnique, create: mocks.membershipCreate },
      divisionJugador: { updateMany: mocks.divisionJugadorUpdateMany },
    }));
  });

  function assignmentRequest() {
    return {
      body: { equipoId: 'team-1', jugadorId: 'player-1', dorsal: 10 },
      user: owner,
    } as unknown as Request;
  }

  it('returns a controlled missing-player error before creating the FK', async () => {
    mocks.jugadorFindUnique.mockResolvedValue(null);
    const next = vi.fn() as NextFunction;

    await jugadorController.assignToTeam(assignmentRequest(), response(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404, message: 'Jugador no encontrado' }));
    expect(mocks.membershipCreate).not.toHaveBeenCalled();
  });

  it('treats an identical existing team membership as success', async () => {
    mocks.jugadorFindUnique.mockResolvedValue({ id: 'player-1' });
    mocks.membershipFindUnique.mockResolvedValueOnce({ equipoId: 'team-1', jugadorId: 'player-1', dorsal: 10 });
    const res = response();
    const next = vi.fn() as NextFunction;

    await jugadorController.assignToTeam(assignmentRequest(), res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
    expect(mocks.membershipCreate).not.toHaveBeenCalled();
  });

  it('rejects an existing team membership with a different dorsal', async () => {
    mocks.jugadorFindUnique.mockResolvedValue({ id: 'player-1' });
    mocks.membershipFindUnique.mockResolvedValueOnce({ equipoId: 'team-1', jugadorId: 'player-1', dorsal: 9 });
    const next = vi.fn() as NextFunction;

    await jugadorController.assignToTeam(assignmentRequest(), response(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409, message: 'El jugador ya pertenece a este equipo' }));
  });

  it('distinguishes an occupied dorsal', async () => {
    mocks.jugadorFindUnique.mockResolvedValue({ id: 'player-1' });
    mocks.membershipFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ jugadorId: 'other-player' });
    const next = vi.fn() as NextFunction;

    await jugadorController.assignToTeam(assignmentRequest(), response(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409, message: 'El dorsal ya está ocupado en este equipo' }));
  });

  it('treats an identical duplicate-membership race after P2002 as success', async () => {
    mocks.jugadorFindUnique.mockResolvedValue({ id: 'player-1' });
    mocks.membershipFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({ equipoId: 'team-1', jugadorId: 'player-1', dorsal: 10 });
    mocks.membershipCreate.mockRejectedValue({ code: 'P2002' });
    const res = response();
    const next = vi.fn() as NextFunction;

    await jugadorController.assignToTeam(assignmentRequest(), res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it('refreshes preserved division dorsals when a player rejoins the team', async () => {
    mocks.jugadorFindUnique.mockResolvedValue({ id: 'player-1' });
    mocks.membershipFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    mocks.membershipCreate.mockResolvedValue({ equipoId: 'team-1', jugadorId: 'player-1', dorsal: 10 });
    const next = vi.fn() as NextFunction;

    await jugadorController.assignToTeam(assignmentRequest(), response(), next);

    expect(mocks.divisionJugadorUpdateMany).toHaveBeenCalledWith({
      where: { equipoId: 'team-1', jugadorId: 'player-1' },
      data: { dorsal: 10 },
    });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('jugadorController.update team dorsal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.equipoFindUnique.mockResolvedValue({ userId: owner.id });
    mocks.mediaPrepare.mockResolvedValue(null);
    mocks.jugadorFindUniqueOrThrow
      .mockResolvedValueOnce({ foto: null, fotoPublicId: null })
      .mockResolvedValueOnce({ id: 'player-1', nombre: 'Player', equipos: [{ equipoId: 'team-1', dorsal: 12 }] });
    mocks.membershipFindUnique.mockResolvedValue({ jugadorId: 'player-1' });
    mocks.transaction.mockImplementation((work) => work({
      jugador: { findUniqueOrThrow: mocks.jugadorFindUniqueOrThrow },
      equipoJugador: { findUnique: mocks.membershipFindUnique, update: mocks.membershipUpdate },
      divisionJugador: { updateMany: mocks.divisionJugadorUpdateMany },
    }));
  });

  function updateRequest() {
    return {
      params: { id: 'player-1' },
      body: { equipoId: 'team-1', dorsal: 12 },
      user: owner,
    } as unknown as Request;
  }

  it('updates the team membership and every preserved division roster', async () => {
    const next = vi.fn() as NextFunction;

    await jugadorController.update(updateRequest(), response(), next);

    expect(mocks.membershipUpdate).toHaveBeenCalledWith({
      where: { equipoId_jugadorId: { equipoId: 'team-1', jugadorId: 'player-1' } },
      data: { dorsal: 12 },
    });
    expect(mocks.divisionJugadorUpdateMany).toHaveBeenCalledWith({
      where: { equipoId: 'team-1', jugadorId: 'player-1' },
      data: { dorsal: 12 },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns a controlled conflict when the dorsal is occupied', async () => {
    mocks.membershipUpdate.mockRejectedValue({ code: 'P2002' });
    const next = vi.fn() as NextFunction;

    await jugadorController.update(updateRequest(), response(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409, message: 'Ese dorsal ya está usado en este equipo' }));
  });
});

describe('jugadorController division roster management', () => {
  const teamOwner: AuthenticatedUser = { id: 'team-owner', email: 'captain@test.com', rol: 'CAPITAN' };
  const leagueOwner: AuthenticatedUser = { id: 'league-owner', email: 'league@test.com', rol: 'LIGA' };
  const outsider: AuthenticatedUser = { id: 'outsider', email: 'outsider@test.com', rol: 'LIGA' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resourceAccessObserveInTransaction.mockResolvedValue(undefined);
    mocks.divisionEquipoFindUnique.mockResolvedValue({
      equipo: { userId: teamOwner.id },
      division: { liga: { userId: leagueOwner.id } },
    });
    mocks.membershipFindUnique.mockResolvedValue({ jugadorId: 'player-1', dorsal: 10 });
    mocks.divisionJugadorCreate.mockResolvedValue({
      divisionId: 'division-1', equipoId: 'team-1', jugadorId: 'player-1', dorsal: 10,
      jugador: { id: 'player-1', nombre: 'Player', showPhoneInPublicProfile: false },
    });
    mocks.transaction.mockImplementation((work) => work({
      divisionEquipo: { findUnique: mocks.divisionEquipoFindUnique },
      equipoJugador: { findUnique: mocks.membershipFindUnique },
      divisionJugador: { create: mocks.divisionJugadorCreate, delete: mocks.divisionJugadorDelete },
    }));
  });

  function assignRequest(actor: AuthenticatedUser) {
    return {
      body: { divisionId: 'division-1', equipoId: 'team-1', jugadorId: 'player-1' },
      user: actor,
    } as unknown as Request;
  }

  it.each([leagueOwner, admin])('allows an authorized roster manager (%#)', async (actor) => {
    const next = vi.fn() as NextFunction;

    await jugadorController.assignToDivision(assignRequest(actor), response(), next);

    expect(mocks.divisionJugadorCreate).toHaveBeenCalledWith({
      data: { divisionId: 'division-1', equipoId: 'team-1', jugadorId: 'player-1', dorsal: 10 },
      include: { jugador: true },
    });
    expect(mocks.resourceAccessObserveInTransaction).toHaveBeenCalledWith(expect.anything(), {
      operation: 'division-roster.assign', capability: 'MANAGE_DIVISION', actor,
      divisionId: 'division-1', resourceType: 'DIVISION',
    });
    expect(mocks.resourceAccessObserveInTransaction.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.divisionJugadorCreate.mock.invocationCallOrder[0]);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not assign when the transactional gate rejects access', async () => {
    const denied = new Error('denied');
    mocks.resourceAccessObserveInTransaction.mockRejectedValue(denied);
    const next = vi.fn() as NextFunction;

    await jugadorController.assignToDivision(assignRequest(leagueOwner), response(), next);

    expect(next).toHaveBeenCalledWith(denied);
    expect(mocks.membershipFindUnique).not.toHaveBeenCalled();
    expect(mocks.divisionJugadorCreate).not.toHaveBeenCalled();
  });

  it('hides the division team roster from an unrelated user', async () => {
    const next = vi.fn() as NextFunction;

    await jugadorController.assignToDivision(assignRequest(outsider), response(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404, message: 'Equipo en división no encontrado' }));
    expect(mocks.membershipFindUnique).not.toHaveBeenCalled();
    expect(mocks.divisionJugadorCreate).not.toHaveBeenCalled();
  });

  it('keeps the division roster read-only for the team owner', async () => {
    const assignNext = vi.fn() as NextFunction;
    const removeNext = vi.fn() as NextFunction;
    const removeRequest = {
      params: { divisionId: 'division-1', equipoId: 'team-1', jugadorId: 'player-1' },
      user: teamOwner,
    } as unknown as Request;

    await jugadorController.assignToDivision(assignRequest(teamOwner), response(), assignNext);
    await jugadorController.removeFromDivision(removeRequest, response(), removeNext);

    expect(assignNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(removeNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(mocks.divisionJugadorCreate).not.toHaveBeenCalled();
    expect(mocks.divisionJugadorDelete).not.toHaveBeenCalled();
  });

  it('rejects a player who is not on the selected team', async () => {
    mocks.membershipFindUnique.mockResolvedValue(null);
    const next = vi.fn() as NextFunction;

    await jugadorController.assignToDivision(assignRequest(leagueOwner), response(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422, message: 'El jugador debe pertenecer al equipo' }));
    expect(mocks.divisionJugadorCreate).not.toHaveBeenCalled();
  });

  it('allows the league owner to remove a player from the division roster', async () => {
    const req = {
      params: { divisionId: 'division-1', equipoId: 'team-1', jugadorId: 'player-1' },
      user: leagueOwner,
    } as unknown as Request;
    const next = vi.fn() as NextFunction;

    await jugadorController.removeFromDivision(req, response(), next);

    expect(mocks.divisionJugadorDelete).toHaveBeenCalledWith({
      where: { divisionId_equipoId_jugadorId: { divisionId: 'division-1', equipoId: 'team-1', jugadorId: 'player-1' } },
    });
    expect(mocks.resourceAccessObserveInTransaction).toHaveBeenCalledWith(expect.anything(), {
      operation: 'division-roster.remove', capability: 'MANAGE_DIVISION', actor: leagueOwner,
      divisionId: 'division-1', resourceType: 'DIVISION',
    });
    expect(mocks.resourceAccessObserveInTransaction.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.divisionJugadorDelete.mock.invocationCallOrder[0]);
    expect(next).not.toHaveBeenCalled();
  });
});
