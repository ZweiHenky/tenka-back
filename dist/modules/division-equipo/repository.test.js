"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    divisionFindFirst: vitest_1.vi.fn(),
    divisionEquipoFindMany: vitest_1.vi.fn(),
    divisionEquipoCreate: vitest_1.vi.fn(),
    divisionEquipoUpdateMany: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        division: { findFirst: mocks.divisionFindFirst },
        divisionEquipo: {
            findMany: mocks.divisionEquipoFindMany,
            create: mocks.divisionEquipoCreate,
            updateMany: mocks.divisionEquipoUpdateMany,
        },
    },
}));
const repository_1 = require("./repository");
const owner = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
(0, vitest_1.describe)('divisionEquipoRepository.findByDivision', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
    });
    vitest_1.it.each([
        [undefined, { estadoLiga: { nombre: { not: 'Borrador' } } }, false, false],
        [owner, { OR: [
                    { estadoLiga: { nombre: { not: 'Borrador' } } },
                    { liga: { userId: owner.id } },
                ] }, true, true],
        [admin, {}, true, false],
    ])('retrieves pivots with the visibility filter for %#', async (actor, visibility, includeSaldo, includeOwner) => {
        const equipos = [{ divisionId: 'division-1', equipoId: 'equipo-1', saldoPendiente: { toFixed: () => '12.30' } }];
        mocks.divisionFindFirst.mockResolvedValue({ equipos, ...(includeOwner ? { liga: { userId: owner.id } } : {}) });
        await (0, vitest_1.expect)(repository_1.divisionEquipoRepository.findByDivision('division-1', actor)).resolves.toEqual([{
                divisionId: 'division-1',
                equipoId: 'equipo-1',
                ...(includeSaldo ? { saldoPendiente: '12.30' } : {}),
            }]);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledWith({
            where: { id: 'division-1', ...visibility },
            select: {
                equipos: { select: {
                        divisionId: true,
                        equipoId: true,
                        ...(includeSaldo ? { saldoPendiente: true } : {}),
                    } },
                ...(includeOwner ? { liga: { select: { userId: true } } } : {}),
            },
        });
    });
    (0, vitest_1.it)('distinguishes a visible division without teams from a hidden or missing division', async () => {
        mocks.divisionFindFirst.mockResolvedValueOnce({ equipos: [] }).mockResolvedValueOnce(null);
        await (0, vitest_1.expect)(repository_1.divisionEquipoRepository.findByDivision('visible')).resolves.toEqual([]);
        await (0, vitest_1.expect)(repository_1.divisionEquipoRepository.findByDivision('hidden-or-missing')).resolves.toBeNull();
    });
    (0, vitest_1.it)('omits saldo for an authenticated nonowner without a second query', async () => {
        mocks.divisionFindFirst.mockResolvedValue({
            liga: { userId: 'another-owner' },
            equipos: [{ divisionId: 'division-1', equipoId: 'equipo-1', saldoPendiente: { toFixed: () => '8.00' } }],
        });
        await (0, vitest_1.expect)(repository_1.divisionEquipoRepository.findByDivision('division-1', owner)).resolves.toEqual([
            { divisionId: 'division-1', equipoId: 'equipo-1' },
        ]);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledOnce();
    });
});
(0, vitest_1.describe)('divisionEquipoRepository saldo boundaries', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('explicitly selects no saldo when listing by equipo', async () => {
        mocks.divisionEquipoFindMany.mockResolvedValue([]);
        await repository_1.divisionEquipoRepository.findByEquipo('equipo-1', owner);
        (0, vitest_1.expect)(mocks.divisionEquipoFindMany).toHaveBeenCalledWith({
            where: { equipoId: 'equipo-1', division: { OR: [
                        { estadoLiga: { nombre: { not: 'Borrador' } } },
                        { liga: { userId: owner.id } },
                    ] } },
            select: {
                divisionId: true,
                equipoId: true,
                division: { include: {
                        liga: { select: { id: true, nombre: true, logo: true } },
                        estadoLiga: { select: { id: true, nombre: true } },
                    } },
            },
        });
    });
    (0, vitest_1.it)('returns the default create saldo as a canonical string', async () => {
        mocks.divisionEquipoCreate.mockResolvedValue({
            divisionId: 'division-1', equipoId: 'equipo-1', saldoPendiente: { toFixed: () => '0.00' },
        });
        await (0, vitest_1.expect)(repository_1.divisionEquipoRepository.create({ divisionId: 'division-1', equipoId: 'equipo-1' }))
            .resolves.toEqual({ divisionId: 'division-1', equipoId: 'equipo-1', saldoPendiente: '0.00' });
        (0, vitest_1.expect)(mocks.divisionEquipoCreate).toHaveBeenCalledWith({
            data: { divisionId: 'division-1', equipoId: 'equipo-1' },
        });
    });
    vitest_1.it.each([
        [owner, { division: { liga: { userId: owner.id } } }],
        [admin, {}],
    ])('constrains saldo updates for actor %#', async (actor, authorization) => {
        mocks.divisionEquipoUpdateMany.mockResolvedValue({ count: 1 });
        await (0, vitest_1.expect)(repository_1.divisionEquipoRepository.updateSaldoPendiente('division-1', 'equipo-1', '25.50', actor)).resolves.toBe(true);
        (0, vitest_1.expect)(mocks.divisionEquipoUpdateMany).toHaveBeenCalledWith({
            where: { divisionId: 'division-1', equipoId: 'equipo-1', ...authorization },
            data: { saldoPendiente: '25.50' },
        });
    });
    (0, vitest_1.it)('reports a hidden or missing pivot without revealing which condition failed', async () => {
        mocks.divisionEquipoUpdateMany.mockResolvedValue({ count: 0 });
        await (0, vitest_1.expect)(repository_1.divisionEquipoRepository.updateSaldoPendiente('division-1', 'equipo-1', '1.00', owner)).resolves.toBe(false);
        (0, vitest_1.expect)(mocks.divisionEquipoUpdateMany).toHaveBeenCalledOnce();
    });
});
//# sourceMappingURL=repository.test.js.map