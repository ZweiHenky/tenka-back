"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({ divisionFindFirst: vitest_1.vi.fn() }));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: { division: { findFirst: mocks.divisionFindFirst } },
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
    return { status: vitest_1.vi.fn().mockReturnThis(), json: vitest_1.vi.fn() };
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
//# sourceMappingURL=controller.test.js.map