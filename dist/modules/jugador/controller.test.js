"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    divisionFindFirst: vitest_1.vi.fn(),
    equipoFindUnique: vitest_1.vi.fn(),
    jugadorFindFirst: vitest_1.vi.fn(),
    jugadorFindUnique: vitest_1.vi.fn(),
    membershipFindUnique: vitest_1.vi.fn(),
    membershipCreate: vitest_1.vi.fn(),
    divisionEquipoFindUnique: vitest_1.vi.fn(),
    divisionJugadorCreate: vitest_1.vi.fn(),
    divisionJugadorDelete: vitest_1.vi.fn(),
    divisionJugadorUpdateMany: vitest_1.vi.fn(),
    transaction: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        division: { findFirst: mocks.divisionFindFirst },
        equipo: { findUnique: mocks.equipoFindUnique },
        jugador: { findFirst: mocks.jugadorFindFirst, findUnique: mocks.jugadorFindUnique },
        equipoJugador: { findUnique: mocks.membershipFindUnique, create: mocks.membershipCreate },
        divisionEquipo: { findUnique: mocks.divisionEquipoFindUnique },
        divisionJugador: { create: mocks.divisionJugadorCreate, delete: mocks.divisionJugadorDelete, updateMany: mocks.divisionJugadorUpdateMany },
        $transaction: mocks.transaction,
    },
}));
vitest_1.vi.mock('../media/service', () => ({
    mediaService: { scheduleImageCleanup: vitest_1.vi.fn() },
}));
const controller_1 = require("./controller");
const owner = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
function request(actor) {
    return { params: { divisionId: 'division-1', equipoId: 'team-1' }, user: actor };
}
function response() {
    return { status: vitest_1.vi.fn().mockReturnThis(), json: vitest_1.vi.fn(), end: vitest_1.vi.fn() };
}
(0, vitest_1.describe)('jugadorController.listByDivisionTeam', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    vitest_1.it.each([
        [undefined, { estadoLiga: { nombre: { not: 'Borrador' } } }],
        [owner, { OR: [
                    { estadoLiga: { nombre: { not: 'Borrador' } } },
                    { liga: { userId: owner.id } },
                ] }],
        [admin, {}],
    ])('retrieves the roster from one visible parent for actor %#', async (actor, visibility) => {
        mocks.divisionFindFirst.mockResolvedValue({ jugadores: [] });
        const res = response();
        const next = vitest_1.vi.fn();
        await controller_1.jugadorController.listByDivisionTeam(request(actor), res, next);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledWith({
            where: { id: 'division-1', ...visibility },
            select: {
                jugadores: {
                    where: { equipoId: 'team-1' },
                    include: { jugador: true },
                    orderBy: { jugador: { nombre: 'asc' } },
                },
            },
        });
        (0, vitest_1.expect)(res.json).toHaveBeenCalledWith({ success: true, data: [] });
        (0, vitest_1.expect)(next).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('returns 404 through error handling for a hidden or missing division', async () => {
        mocks.divisionFindFirst.mockResolvedValue(null);
        const next = vitest_1.vi.fn();
        await controller_1.jugadorController.listByDivisionTeam(request(), response(), next);
        (0, vitest_1.expect)(next).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            statusCode: 404, message: 'División no encontrado',
        }));
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('sanitizes the public roster without an additional operation', async () => {
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
        await controller_1.jugadorController.listByDivisionTeam(request(), res, vitest_1.vi.fn());
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(res.json).toHaveBeenCalledWith({ success: true, data: [vitest_1.expect.objectContaining({
                    jugador: vitest_1.expect.objectContaining({ telefono: null, userId: undefined, fotoPublicId: undefined }),
                })] });
    });
});
(0, vitest_1.describe)('jugadorController.lookupByPhone', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    function lookupRequest(actor = owner, telefono = '+5215512345678', equipoId = 'team-1') {
        return { params: { equipoId }, body: { telefono }, user: actor };
    }
    (0, vitest_1.it)('rejects a non-canonical E.164 phone before ownership or lookup queries', async () => {
        const next = vitest_1.vi.fn();
        await controller_1.jugadorController.lookupByPhone(lookupRequest(owner, '521 55 1234 5678'), response(), next);
        (0, vitest_1.expect)(next).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ statusCode: 422 }));
        (0, vitest_1.expect)(mocks.equipoFindUnique).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.jugadorFindFirst).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('hides a foreign team while allowing its owner or an admin', async () => {
        mocks.equipoFindUnique.mockResolvedValue({ userId: 'owner-1' });
        mocks.jugadorFindFirst.mockResolvedValue(null);
        const foreign = { id: 'other-1', email: 'other@test.com', rol: 'CAPITAN' };
        const foreignNext = vitest_1.vi.fn();
        await controller_1.jugadorController.lookupByPhone(lookupRequest(foreign), response(), foreignNext);
        await controller_1.jugadorController.lookupByPhone(lookupRequest(owner), response(), vitest_1.vi.fn());
        await controller_1.jugadorController.lookupByPhone(lookupRequest(admin), response(), vitest_1.vi.fn());
        (0, vitest_1.expect)(foreignNext).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ statusCode: 404, message: 'Equipo no encontrado' }));
        (0, vitest_1.expect)(mocks.jugadorFindFirst).toHaveBeenCalledTimes(2);
    });
    (0, vitest_1.it)('searches by the linked account verified phone without relying on the legacy player phone', async () => {
        mocks.equipoFindUnique.mockResolvedValue({ userId: owner.id });
        mocks.jugadorFindFirst.mockResolvedValue(null);
        const next = vitest_1.vi.fn();
        await controller_1.jugadorController.lookupByPhone(lookupRequest(), response(), next);
        (0, vitest_1.expect)(mocks.jugadorFindFirst).toHaveBeenCalledWith({
            where: {
                user: { is: { phoneNumber: '+5215512345678', phoneNumberVerified: true } },
            },
            select: {
                id: true, nombre: true, foto: true, posicion: true,
                equipos: { where: { equipoId: 'team-1' }, select: { dorsal: true }, take: 1 },
            },
        });
        (0, vitest_1.expect)(next).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            statusCode: 404,
            message: 'No encontramos un perfil de jugador con este teléfono',
        }));
    });
    vitest_1.it.each([
        [[], false, null],
        [[{ dorsal: 10 }], true, 10],
    ])('returns only the purpose DTO (membership %#)', async (equipos, yaPertenece, dorsal) => {
        mocks.equipoFindUnique.mockResolvedValue({ userId: owner.id });
        mocks.jugadorFindFirst.mockResolvedValue({
            id: 'player-1', nombre: 'Player', foto: 'photo-url', posicion: 'MEDIO', equipos,
            telefono: '+5215512345678', userId: 'user-1', edad: 20, fotoPublicId: 'secret',
        });
        const res = response();
        await controller_1.jugadorController.lookupByPhone(lookupRequest(), res, vitest_1.vi.fn());
        (0, vitest_1.expect)(res.json).toHaveBeenCalledWith({ success: true, data: {
                id: 'player-1', nombre: 'Player', foto: 'photo-url', posicion: 'MEDIO', yaPertenece, dorsal,
            } });
    });
});
(0, vitest_1.describe)('jugadorController.assignToTeam', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
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
        };
    }
    (0, vitest_1.it)('returns a controlled missing-player error before creating the FK', async () => {
        mocks.jugadorFindUnique.mockResolvedValue(null);
        const next = vitest_1.vi.fn();
        await controller_1.jugadorController.assignToTeam(assignmentRequest(), response(), next);
        (0, vitest_1.expect)(next).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ statusCode: 404, message: 'Jugador no encontrado' }));
        (0, vitest_1.expect)(mocks.membershipCreate).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('treats an identical existing team membership as success', async () => {
        mocks.jugadorFindUnique.mockResolvedValue({ id: 'player-1' });
        mocks.membershipFindUnique.mockResolvedValueOnce({ equipoId: 'team-1', jugadorId: 'player-1', dorsal: 10 });
        const res = response();
        const next = vitest_1.vi.fn();
        await controller_1.jugadorController.assignToTeam(assignmentRequest(), res, next);
        (0, vitest_1.expect)(res.status).toHaveBeenCalledWith(200);
        (0, vitest_1.expect)(next).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.membershipCreate).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('rejects an existing team membership with a different dorsal', async () => {
        mocks.jugadorFindUnique.mockResolvedValue({ id: 'player-1' });
        mocks.membershipFindUnique.mockResolvedValueOnce({ equipoId: 'team-1', jugadorId: 'player-1', dorsal: 9 });
        const next = vitest_1.vi.fn();
        await controller_1.jugadorController.assignToTeam(assignmentRequest(), response(), next);
        (0, vitest_1.expect)(next).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ statusCode: 409, message: 'El jugador ya pertenece a este equipo' }));
    });
    (0, vitest_1.it)('distinguishes an occupied dorsal', async () => {
        mocks.jugadorFindUnique.mockResolvedValue({ id: 'player-1' });
        mocks.membershipFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ jugadorId: 'other-player' });
        const next = vitest_1.vi.fn();
        await controller_1.jugadorController.assignToTeam(assignmentRequest(), response(), next);
        (0, vitest_1.expect)(next).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ statusCode: 409, message: 'El dorsal ya está ocupado en este equipo' }));
    });
    (0, vitest_1.it)('treats an identical duplicate-membership race after P2002 as success', async () => {
        mocks.jugadorFindUnique.mockResolvedValue({ id: 'player-1' });
        mocks.membershipFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({ equipoId: 'team-1', jugadorId: 'player-1', dorsal: 10 });
        mocks.membershipCreate.mockRejectedValue({ code: 'P2002' });
        const res = response();
        const next = vitest_1.vi.fn();
        await controller_1.jugadorController.assignToTeam(assignmentRequest(), res, next);
        (0, vitest_1.expect)(res.status).toHaveBeenCalledWith(200);
        (0, vitest_1.expect)(next).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('refreshes preserved division dorsals when a player rejoins the team', async () => {
        mocks.jugadorFindUnique.mockResolvedValue({ id: 'player-1' });
        mocks.membershipFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
        mocks.membershipCreate.mockResolvedValue({ equipoId: 'team-1', jugadorId: 'player-1', dorsal: 10 });
        const next = vitest_1.vi.fn();
        await controller_1.jugadorController.assignToTeam(assignmentRequest(), response(), next);
        (0, vitest_1.expect)(mocks.divisionJugadorUpdateMany).toHaveBeenCalledWith({
            where: { equipoId: 'team-1', jugadorId: 'player-1' },
            data: { dorsal: 10 },
        });
        (0, vitest_1.expect)(next).not.toHaveBeenCalled();
    });
});
(0, vitest_1.describe)('jugadorController division roster management', () => {
    const teamOwner = { id: 'team-owner', email: 'captain@test.com', rol: 'CAPITAN' };
    const leagueOwner = { id: 'league-owner', email: 'league@test.com', rol: 'LIGA' };
    const outsider = { id: 'outsider', email: 'outsider@test.com', rol: 'LIGA' };
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mocks.divisionEquipoFindUnique.mockResolvedValue({
            equipo: { userId: teamOwner.id },
            division: { liga: { userId: leagueOwner.id } },
        });
        mocks.membershipFindUnique.mockResolvedValue({ jugadorId: 'player-1', dorsal: 10 });
        mocks.divisionJugadorCreate.mockResolvedValue({
            divisionId: 'division-1', equipoId: 'team-1', jugadorId: 'player-1', dorsal: 10,
            jugador: { id: 'player-1', nombre: 'Player', showPhoneInPublicProfile: false },
        });
    });
    function assignRequest(actor) {
        return {
            body: { divisionId: 'division-1', equipoId: 'team-1', jugadorId: 'player-1' },
            user: actor,
        };
    }
    vitest_1.it.each([leagueOwner, admin])('allows an authorized roster manager (%#)', async (actor) => {
        const next = vitest_1.vi.fn();
        await controller_1.jugadorController.assignToDivision(assignRequest(actor), response(), next);
        (0, vitest_1.expect)(mocks.divisionJugadorCreate).toHaveBeenCalledWith({
            data: { divisionId: 'division-1', equipoId: 'team-1', jugadorId: 'player-1', dorsal: 10 },
            include: { jugador: true },
        });
        (0, vitest_1.expect)(next).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('hides the division team roster from an unrelated user', async () => {
        const next = vitest_1.vi.fn();
        await controller_1.jugadorController.assignToDivision(assignRequest(outsider), response(), next);
        (0, vitest_1.expect)(next).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ statusCode: 404, message: 'Equipo en división no encontrado' }));
        (0, vitest_1.expect)(mocks.membershipFindUnique).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.divisionJugadorCreate).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('keeps the division roster read-only for the team owner', async () => {
        const assignNext = vitest_1.vi.fn();
        const removeNext = vitest_1.vi.fn();
        const removeRequest = {
            params: { divisionId: 'division-1', equipoId: 'team-1', jugadorId: 'player-1' },
            user: teamOwner,
        };
        await controller_1.jugadorController.assignToDivision(assignRequest(teamOwner), response(), assignNext);
        await controller_1.jugadorController.removeFromDivision(removeRequest, response(), removeNext);
        (0, vitest_1.expect)(assignNext).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ statusCode: 404 }));
        (0, vitest_1.expect)(removeNext).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ statusCode: 404 }));
        (0, vitest_1.expect)(mocks.divisionJugadorCreate).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.divisionJugadorDelete).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('rejects a player who is not on the selected team', async () => {
        mocks.membershipFindUnique.mockResolvedValue(null);
        const next = vitest_1.vi.fn();
        await controller_1.jugadorController.assignToDivision(assignRequest(leagueOwner), response(), next);
        (0, vitest_1.expect)(next).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ statusCode: 422, message: 'El jugador debe pertenecer al equipo' }));
        (0, vitest_1.expect)(mocks.divisionJugadorCreate).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('allows the league owner to remove a player from the division roster', async () => {
        const req = {
            params: { divisionId: 'division-1', equipoId: 'team-1', jugadorId: 'player-1' },
            user: leagueOwner,
        };
        const next = vitest_1.vi.fn();
        await controller_1.jugadorController.removeFromDivision(req, response(), next);
        (0, vitest_1.expect)(mocks.divisionJugadorDelete).toHaveBeenCalledWith({
            where: { divisionId_equipoId_jugadorId: { divisionId: 'division-1', equipoId: 'team-1', jugadorId: 'player-1' } },
        });
        (0, vitest_1.expect)(next).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=controller.test.js.map