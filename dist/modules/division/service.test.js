"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    ligaFindFirst: vitest_1.vi.fn(),
    divisionFindFirst: vitest_1.vi.fn(),
    estadoLigaFindFirstOrThrow: vitest_1.vi.fn(),
    transaction: vitest_1.vi.fn(),
    subscriptionsFindMany: vitest_1.vi.fn(),
    cleanupCreateMany: vitest_1.vi.fn(),
    jornadaDeleteMany: vitest_1.vi.fn(),
    rondaPlayoffDeleteMany: vitest_1.vi.fn(),
    tablaPosicionDeleteMany: vitest_1.vi.fn(),
    create: vitest_1.vi.fn(),
    update: vitest_1.vi.fn(),
    delete: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        $transaction: mocks.transaction,
        liga: { findFirst: mocks.ligaFindFirst },
        division: { findFirst: mocks.divisionFindFirst },
        estadoLiga: { findFirstOrThrow: mocks.estadoLigaFindFirstOrThrow },
    },
}));
vitest_1.vi.mock('./repository', () => ({
    divisionRepository: {
        create: mocks.create,
        update: mocks.update,
        delete: mocks.delete,
    },
}));
const service_1 = require("./service");
const owner = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };
const createData = {
    nombre: 'Primera',
    maxEquipos: 12,
    ligaId: 'liga-1',
    categoriaId: 'categoria-1',
    tipoId: 'tipo-1',
    tipoCompetenciaId: 'competencia-1',
};
const tx = {
    divisionNotificationSubscription: { findMany: mocks.subscriptionsFindMany },
    oneSignalTagCleanupJob: { createMany: mocks.cleanupCreateMany },
    jornada: { deleteMany: mocks.jornadaDeleteMany },
    rondaPlayoff: { deleteMany: mocks.rondaPlayoffDeleteMany },
    tablaPosicion: { deleteMany: mocks.tablaPosicionDeleteMany },
};
(0, vitest_1.describe)('consultas privadas optimizadas de división', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mocks.ligaFindFirst.mockResolvedValue({ id: 'liga-1' });
        mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1' });
        mocks.transaction.mockImplementation(async (callback) => callback(tx));
        mocks.subscriptionsFindMany.mockResolvedValue([]);
        mocks.create.mockResolvedValue({ id: 'division-1' });
        mocks.update.mockResolvedValue({ id: 'division-1' });
    });
    vitest_1.it.each([
        ['propietario', owner, { id: 'liga-1', userId: owner.id }],
        ['administrador', admin, { id: 'liga-1' }],
    ])('autoriza la liga con una proyección mínima para %s', async (_label, actor, where) => {
        await service_1.divisionService.create({ ...createData, estadoLigaId: 'estado-1' }, actor);
        (0, vitest_1.expect)(mocks.ligaFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.ligaFindFirst).toHaveBeenCalledWith({ where, select: { id: true } });
        (0, vitest_1.expect)(mocks.estadoLigaFindFirstOrThrow).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.create).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('selecciona únicamente el id de la configuración Borrador cuando es necesaria', async () => {
        mocks.estadoLigaFindFirstOrThrow.mockResolvedValue({ id: 'borrador-1' });
        await service_1.divisionService.create(createData, owner);
        (0, vitest_1.expect)(mocks.estadoLigaFindFirstOrThrow).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.estadoLigaFindFirstOrThrow).toHaveBeenCalledWith({
            where: { nombre: 'Borrador' },
            select: { id: true },
        });
        (0, vitest_1.expect)(mocks.create).toHaveBeenCalledWith({ ...createData, estadoLigaId: 'borrador-1' });
    });
    vitest_1.it.each([
        ['propietario', owner, { id: 'division-1', liga: { userId: owner.id } }],
        ['administrador', admin, { id: 'division-1' }],
    ])('autoriza una actualización en una consulta estrecha para %s', async (_label, actor, where) => {
        await service_1.divisionService.update('division-1', { nombre: 'Nueva' }, actor);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledWith({ where, select: { id: true } });
        (0, vitest_1.expect)(mocks.update).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('conserva el 404 y evita escrituras cuando la división no es administrable', async () => {
        mocks.divisionFindFirst.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.divisionService.update('division-1', { nombre: 'Nueva' }, owner)).rejects.toMatchObject({
            statusCode: 404,
            message: 'Division no encontrado',
        });
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.update).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('ejecuta las tres limpiezas del reset en una transacción después de una sola autorización', async () => {
        await service_1.divisionService.resetDivision('division-1', owner);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledWith({
            where: { id: 'division-1', liga: { userId: owner.id } },
            select: { id: true },
        });
        (0, vitest_1.expect)(mocks.jornadaDeleteMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.jornadaDeleteMany).toHaveBeenCalledWith({ where: { divisionId: 'division-1' } });
        (0, vitest_1.expect)(mocks.rondaPlayoffDeleteMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.tablaPosicionDeleteMany).toHaveBeenCalledOnce();
    });
    (0, vitest_1.it)('propaga un fallo del reset y no ejecuta escrituras posteriores fuera de la transacción', async () => {
        const failure = new Error('playoff cleanup failed');
        mocks.rondaPlayoffDeleteMany.mockRejectedValue(failure);
        await (0, vitest_1.expect)(service_1.divisionService.resetDivision('division-1', owner)).rejects.toBe(failure);
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.jornadaDeleteMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.rondaPlayoffDeleteMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.tablaPosicionDeleteMany).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('no abre una transacción de reset si falla la autorización', async () => {
        mocks.divisionFindFirst.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.divisionService.resetDivision('division-1', owner)).rejects.toMatchObject({
            statusCode: 404,
            message: 'Division no encontrado',
        });
        (0, vitest_1.expect)(mocks.transaction).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('crea los jobs de OneSignal en lote y elimina la división en la misma transacción', async () => {
        mocks.subscriptionsFindMany.mockResolvedValue([
            { oneSignalId: 'onesignal-1' },
            { oneSignalId: 'onesignal-2' },
        ]);
        await service_1.divisionService.delete('division-1', owner);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.subscriptionsFindMany).toHaveBeenCalledWith({
            where: { divisionId: 'division-1' },
            select: { oneSignalId: true },
        });
        (0, vitest_1.expect)(mocks.cleanupCreateMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.cleanupCreateMany).toHaveBeenCalledWith({
            data: [
                { oneSignalId: 'onesignal-1', tag: 'division_division-1' },
                { oneSignalId: 'onesignal-2', tag: 'division_division-1' },
            ],
            skipDuplicates: true,
        });
        (0, vitest_1.expect)(mocks.delete).toHaveBeenCalledWith('division-1', tx);
    });
    (0, vitest_1.it)('no elimina la división cuando falla la creación del lote de cleanup', async () => {
        mocks.subscriptionsFindMany.mockResolvedValue([{ oneSignalId: 'onesignal-1' }]);
        const failure = new Error('cleanup queue failed');
        mocks.cleanupCreateMany.mockRejectedValue(failure);
        await (0, vitest_1.expect)(service_1.divisionService.delete('division-1', owner)).rejects.toBe(failure);
        (0, vitest_1.expect)(mocks.delete).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledOnce();
    });
    (0, vitest_1.it)('omite createMany si no hay suscriptores y conserva el presupuesto de consultas', async () => {
        await service_1.divisionService.delete('division-1', owner);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.subscriptionsFindMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.cleanupCreateMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.delete).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledOnce();
    });
    (0, vitest_1.it)('no abre una transacción de eliminación si falla la autorización', async () => {
        mocks.divisionFindFirst.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.divisionService.delete('division-1', owner)).rejects.toMatchObject({
            statusCode: 404,
            message: 'Division no encontrado',
        });
        (0, vitest_1.expect)(mocks.transaction).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.subscriptionsFindMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.delete).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=service.test.js.map