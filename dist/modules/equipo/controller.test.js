"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    list: vitest_1.vi.fn(),
    listPaginated: vitest_1.vi.fn(),
    listByUser: vitest_1.vi.fn(),
    getById: vitest_1.vi.fn(),
    create: vitest_1.vi.fn(),
    update: vitest_1.vi.fn(),
    delete: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('./service', () => ({ equipoService: mocks }));
const controller_1 = require("./controller");
const team = {
    id: 'cm-team-ab12',
    nombre: 'Leones',
    nombreNormalizado: 'leones',
    logo: null,
    logoPublicId: 'private-logo-id',
    userId: 'owner-1',
};
function response() {
    return { status: vitest_1.vi.fn().mockReturnThis(), json: vitest_1.vi.fn(), end: vitest_1.vi.fn() };
}
(0, vitest_1.describe)('equipoController public DTO', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('adds the short code and ownership flag while removing internal fields', async () => {
        mocks.listPaginated.mockResolvedValue({ rows: [team], total: 1 });
        const req = { query: { page: '1', limit: '20' }, user: { id: 'owner-1' } };
        const res = response();
        const next = vitest_1.vi.fn();
        await controller_1.equipoController.list(req, res, next);
        (0, vitest_1.expect)(res.json).toHaveBeenCalledWith({ success: true, data: {
                rows: [{ id: 'cm-team-ab12', nombre: 'Leones', logo: null, codigo: 'AB12', esPropio: true }],
                total: 1,
            } });
        (0, vitest_1.expect)(next).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('marks a team as external for an anonymous request', async () => {
        mocks.getById.mockResolvedValue(team);
        const req = { params: { id: team.id } };
        const res = response();
        await controller_1.equipoController.getById(req, res, vitest_1.vi.fn());
        (0, vitest_1.expect)(res.json).toHaveBeenCalledWith({ success: true, data: vitest_1.expect.objectContaining({
                codigo: 'AB12', esPropio: false,
            }) });
    });
});
//# sourceMappingURL=controller.test.js.map