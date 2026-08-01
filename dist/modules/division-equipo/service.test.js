"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    findByDivision: vitest_1.vi.fn(),
    findByEquipo: vitest_1.vi.fn(),
    create: vitest_1.vi.fn(),
    updateSaldoPendiente: vitest_1.vi.fn(),
    delete: vitest_1.vi.fn(),
    transaction: vitest_1.vi.fn(),
    divisionFindFirst: vitest_1.vi.fn(),
    divisionEquipoCount: vitest_1.vi.fn(),
    tablaPosicionDeleteMany: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('./repository', () => ({
    divisionEquipoRepository: {
        findByDivision: mocks.findByDivision,
        findByEquipo: mocks.findByEquipo,
        create: mocks.create,
        updateSaldoPendiente: mocks.updateSaldoPendiente,
        delete: mocks.delete,
    },
}));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        $transaction: mocks.transaction,
        division: { findFirst: mocks.divisionFindFirst },
    },
}));
const service_1 = require("./service");
const owner = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
const tx = {
    division: { findFirst: mocks.divisionFindFirst },
    divisionEquipo: { count: mocks.divisionEquipoCount },
    tablaPosicion: { deleteMany: mocks.tablaPosicionDeleteMany },
};
(0, vitest_1.describe)('divisionEquipoService.findByDivision', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mocks.transaction.mockImplementation(async (callback) => callback(tx));
    });
    (0, vitest_1.it)('returns an empty list for a visible division without teams using one domain operation', async () => {
        mocks.findByDivision.mockResolvedValue([]);
        await (0, vitest_1.expect)(service_1.divisionEquipoService.findByDivision('division-1', owner)).resolves.toEqual([]);
        (0, vitest_1.expect)(mocks.findByDivision).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.findByDivision).toHaveBeenCalledWith('division-1', owner);
    });
    (0, vitest_1.it)('returns 404 when the division is hidden or missing', async () => {
        mocks.findByDivision.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.divisionEquipoService.findByDivision('division-1')).rejects.toMatchObject({
            statusCode: 404,
            message: 'División no encontrado',
        });
        (0, vitest_1.expect)(mocks.findByDivision).toHaveBeenCalledTimes(1);
    });
});
(0, vitest_1.describe)('divisionEquipoService query and saldo update', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('delegates equipo visibility and omission to one repository operation', async () => {
        mocks.findByEquipo.mockResolvedValue([{ divisionId: 'division-1', equipoId: 'equipo-1' }]);
        await (0, vitest_1.expect)(service_1.divisionEquipoService.findByEquipo('equipo-1', owner)).resolves.toEqual([
            { divisionId: 'division-1', equipoId: 'equipo-1' },
        ]);
        (0, vitest_1.expect)(mocks.findByEquipo).toHaveBeenCalledWith('equipo-1', owner);
    });
    (0, vitest_1.it)('returns the canonical saldo after an authorized update', async () => {
        mocks.updateSaldoPendiente.mockResolvedValue(true);
        await (0, vitest_1.expect)(service_1.divisionEquipoService.updateSaldoPendiente('division-1', 'equipo-1', '10.50', owner)).resolves.toEqual({ divisionId: 'division-1', equipoId: 'equipo-1', saldoPendiente: '10.50' });
        (0, vitest_1.expect)(mocks.updateSaldoPendiente).toHaveBeenCalledWith('division-1', 'equipo-1', '10.50', owner);
    });
    vitest_1.it.each([owner, admin])('uses the same 404 for missing pivots and unauthorized actors', async (actor) => {
        mocks.updateSaldoPendiente.mockResolvedValue(false);
        await (0, vitest_1.expect)(service_1.divisionEquipoService.updateSaldoPendiente('division-1', 'equipo-1', '10.50', actor)).rejects.toMatchObject({ statusCode: 404, message: 'Equipo de la división no encontrado' });
        (0, vitest_1.expect)(mocks.updateSaldoPendiente).toHaveBeenCalledOnce();
    });
});
(0, vitest_1.describe)('divisionEquipoService private management queries', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mocks.transaction.mockImplementation(async (callback) => callback(tx));
        mocks.divisionFindFirst.mockResolvedValue({ maxEquipos: 10 });
        mocks.divisionEquipoCount.mockResolvedValue(3);
        mocks.create.mockResolvedValue({ divisionId: 'division-1', equipoId: 'equipo-1' });
        mocks.delete.mockResolvedValue(undefined);
        mocks.tablaPosicionDeleteMany.mockResolvedValue({ count: 1 });
    });
    vitest_1.it.each([
        ['owner', owner, { id: 'division-1', liga: { userId: owner.id } }],
        ['admin', admin, { id: 'division-1' }],
    ])('loads only capacity and constrained authorization for %s creation', async (_label, actor, where) => {
        await service_1.divisionEquipoService.create({ divisionId: 'division-1', equipoId: 'equipo-1' }, actor);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledWith({ where, select: { maxEquipos: true } });
        (0, vitest_1.expect)(mocks.divisionEquipoCount).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.create).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.create).toHaveBeenCalledWith({ divisionId: 'division-1', equipoId: 'equipo-1' }, tx);
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledWith(vitest_1.expect.any(Function), { isolationLevel: 'Serializable' });
    });
    (0, vitest_1.it)('keeps 404 behavior and stops before count/write for a foreign division', async () => {
        mocks.divisionFindFirst.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.divisionEquipoService.create({ divisionId: 'division-1', equipoId: 'equipo-1' }, owner))
            .rejects.toMatchObject({ statusCode: 404, message: 'División no encontrado' });
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.divisionEquipoCount).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.create).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('conserva el error de capacidad y no intenta crear la relación', async () => {
        mocks.divisionFindFirst.mockResolvedValue({ maxEquipos: 3 });
        mocks.divisionEquipoCount.mockResolvedValue(3);
        await (0, vitest_1.expect)(service_1.divisionEquipoService.create({ divisionId: 'division-1', equipoId: 'equipo-1' }, owner))
            .rejects.toMatchObject({
            statusCode: 422,
            message: 'La división ya alcanzó el máximo de 3 equipos',
        });
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.create).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('elimina la relación y standings atómicamente después de autorización estrecha', async () => {
        mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1' });
        await service_1.divisionEquipoService.delete('division-1', 'equipo-1', owner);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledWith({
            where: { id: 'division-1', liga: { userId: owner.id } },
            select: { id: true },
        });
        (0, vitest_1.expect)(mocks.delete).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.delete).toHaveBeenCalledWith('division-1', 'equipo-1', tx);
        (0, vitest_1.expect)(mocks.tablaPosicionDeleteMany).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.delete.mock.invocationCallOrder[0]).toBeLessThan(mocks.tablaPosicionDeleteMany.mock.invocationCallOrder[0]);
    });
    (0, vitest_1.it)('detiene la limpieza de standings si falla el delete de la relación', async () => {
        mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1' });
        const failure = new Error('pivot delete failed');
        mocks.delete.mockRejectedValue(failure);
        await (0, vitest_1.expect)(service_1.divisionEquipoService.delete('division-1', 'equipo-1', owner)).rejects.toBe(failure);
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.tablaPosicionDeleteMany).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('propaga el fallo de standings para que la transacción revierta el delete', async () => {
        mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1' });
        const failure = new Error('standings cleanup failed');
        mocks.tablaPosicionDeleteMany.mockRejectedValue(failure);
        await (0, vitest_1.expect)(service_1.divisionEquipoService.delete('division-1', 'equipo-1', owner)).rejects.toBe(failure);
        (0, vitest_1.expect)(mocks.delete).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.tablaPosicionDeleteMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledOnce();
    });
    (0, vitest_1.it)('no abre una transacción de eliminación si falla la autorización', async () => {
        mocks.divisionFindFirst.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.divisionEquipoService.delete('division-1', 'equipo-1', owner)).rejects.toMatchObject({
            statusCode: 404,
            message: 'División no encontrado',
        });
        (0, vitest_1.expect)(mocks.transaction).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.delete).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('reintenta conflictos serializables y mantiene tres consultas por intento exitoso', async () => {
        mocks.transaction
            .mockRejectedValueOnce(Object.assign(new Error('write conflict'), { code: 'P2034' }))
            .mockImplementationOnce(async (callback) => callback(tx));
        await service_1.divisionEquipoService.create({ divisionId: 'division-1', equipoId: 'equipo-1' }, owner);
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.divisionEquipoCount).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.create).toHaveBeenCalledOnce();
    });
    (0, vitest_1.it)('limita a tres intentos los conflictos serializables', async () => {
        const failure = Object.assign(new Error('write conflict'), { code: 'P2034' });
        mocks.transaction.mockRejectedValue(failure);
        await (0, vitest_1.expect)(service_1.divisionEquipoService.create({ divisionId: 'division-1', equipoId: 'equipo-1' }, owner))
            .rejects.toBe(failure);
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledTimes(3);
    });
    (0, vitest_1.it)('no excede el presupuesto normal de una transacción y tres consultas de creación', async () => {
        await service_1.divisionEquipoService.create({ divisionId: 'division-1', equipoId: 'equipo-1' }, owner);
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.divisionEquipoCount).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.create).toHaveBeenCalledOnce();
    });
});
//# sourceMappingURL=service.test.js.map