"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => ({
    ligaFindFirst: vitest_1.vi.fn(),
    ligaCanchaFindFirst: vitest_1.vi.fn(),
    divisionFindFirst: vitest_1.vi.fn(),
    estadoLigaFindFirstOrThrow: vitest_1.vi.fn(),
    transaction: vitest_1.vi.fn(),
    subscriptionsFindMany: vitest_1.vi.fn(),
    cleanupUpsert: vitest_1.vi.fn(),
    jornadaDeleteMany: vitest_1.vi.fn(),
    rondaPlayoffDeleteMany: vitest_1.vi.fn(),
    tablaPosicionDeleteMany: vitest_1.vi.fn(),
    partidoCount: vitest_1.vi.fn(),
    create: vitest_1.vi.fn(),
    update: vitest_1.vi.fn(),
    delete: vitest_1.vi.fn(),
    acquireLeagueScheduleLock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../config/database', () => ({
    prisma: {
        $transaction: mocks.transaction,
        liga: { findFirst: mocks.ligaFindFirst },
        ligaCancha: { findFirst: mocks.ligaCanchaFindFirst },
        division: { findFirst: mocks.divisionFindFirst },
        estadoLiga: { findFirstOrThrow: mocks.estadoLigaFindFirstOrThrow },
        partido: { count: mocks.partidoCount },
    },
}));
vitest_1.vi.mock('./repository', () => ({
    divisionRepository: {
        create: mocks.create,
        update: mocks.update,
        delete: mocks.delete,
    },
}));
vitest_1.vi.mock('../../utils/leagueScheduleLock', () => ({
    acquireLeagueScheduleLock: mocks.acquireLeagueScheduleLock,
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
    liga: { findFirst: mocks.ligaFindFirst },
    ligaCancha: { findFirst: mocks.ligaCanchaFindFirst },
    division: { findFirst: mocks.divisionFindFirst },
    divisionNotificationSubscription: { findMany: mocks.subscriptionsFindMany },
    oneSignalTagCleanupJob: { upsert: mocks.cleanupUpsert },
    jornada: { deleteMany: mocks.jornadaDeleteMany },
    rondaPlayoff: { deleteMany: mocks.rondaPlayoffDeleteMany },
    tablaPosicion: { deleteMany: mocks.tablaPosicionDeleteMany },
    partido: { count: mocks.partidoCount },
};
(0, vitest_1.describe)('consultas privadas optimizadas de división', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mocks.ligaFindFirst.mockResolvedValue({ id: 'liga-1' });
        mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1', ligaId: 'liga-1', canchaUnicaId: null, usarPenalesEnEmpates: true });
        mocks.partidoCount.mockResolvedValue(0);
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
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledWith({ where, select: { id: true, ligaId: true, canchaUnicaId: true, registrarParticipaciones: true, usarPenalesEnEmpates: true } });
        (0, vitest_1.expect)(mocks.update).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('guarda una cancha fija activa de la misma liga', async () => {
        mocks.ligaCanchaFindFirst.mockResolvedValue({ ligaId: 'liga-1', activa: true, liga: { multiplesCanchas: true } });
        await service_1.divisionService.update('division-1', { canchaUnicaId: 'court-1' }, owner);
        (0, vitest_1.expect)(mocks.update).toHaveBeenCalledWith('division-1', { canchaUnicaId: 'court-1' });
    });
    vitest_1.it.each([
        [{ ligaId: 'otra-liga', activa: true, liga: { multiplesCanchas: true } }, 'no pertenece a esta liga'],
        [{ ligaId: 'liga-1', activa: false, liga: { multiplesCanchas: true } }, 'no está activa'],
        [{ ligaId: 'liga-1', activa: true, liga: { multiplesCanchas: false } }, 'no tiene múltiples canchas'],
    ])('rechaza una cancha fija inválida', async (cancha, message) => {
        mocks.ligaCanchaFindFirst.mockResolvedValue(cancha);
        await (0, vitest_1.expect)(service_1.divisionService.update('division-1', { canchaUnicaId: 'court-1' }, owner)).rejects.toThrow(message);
        (0, vitest_1.expect)(mocks.update).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('limpia la cancha fija al mover la división a otra liga', async () => {
        mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1', ligaId: 'liga-1', canchaUnicaId: 'court-1' });
        await service_1.divisionService.update('division-1', { ligaId: 'liga-2' }, owner);
        (0, vitest_1.expect)(mocks.update).toHaveBeenCalledWith('division-1', { ligaId: 'liga-2', canchaUnicaId: null });
    });
    (0, vitest_1.it)('siempre bloquea la liga y relee la división cuando se envía registrarParticipaciones', async () => {
        mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1', ligaId: 'liga-1', canchaUnicaId: null, registrarParticipaciones: false });
        await service_1.divisionService.update('division-1', { registrarParticipaciones: true }, owner);
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledWith(vitest_1.expect.any(Function), { isolationLevel: 'ReadCommitted' });
        (0, vitest_1.expect)(mocks.acquireLeagueScheduleLock).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mocks.acquireLeagueScheduleLock).toHaveBeenCalledWith(tx, 'liga-1');
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(mocks.acquireLeagueScheduleLock.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.divisionFindFirst.mock.invocationCallOrder[1]);
        (0, vitest_1.expect)(mocks.update).toHaveBeenCalledWith('division-1', { registrarParticipaciones: true }, tx);
    });
    (0, vitest_1.it)('también bloquea cuando el valor preflight de registrarParticipaciones parece idéntico', async () => {
        mocks.divisionFindFirst.mockResolvedValue({ id: 'division-1', ligaId: 'liga-1', canchaUnicaId: null, registrarParticipaciones: true });
        await service_1.divisionService.update('division-1', { registrarParticipaciones: true }, owner);
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.acquireLeagueScheduleLock).toHaveBeenCalledWith(tx, 'liga-1');
        (0, vitest_1.expect)(mocks.update).toHaveBeenCalledWith('division-1', { registrarParticipaciones: true }, tx);
    });
    (0, vitest_1.it)('permite cambiar la regla de penales antes de finalizar partidos', async () => {
        mocks.divisionFindFirst.mockResolvedValue({
            id: 'division-1', ligaId: 'liga-1', canchaUnicaId: null,
            registrarParticipaciones: false, usarPenalesEnEmpates: true,
        });
        await service_1.divisionService.update('division-1', { usarPenalesEnEmpates: false }, owner);
        (0, vitest_1.expect)(mocks.partidoCount).toHaveBeenCalledWith({
            where: {
                estado: 'FINALIZADO',
                OR: [{ jornada: { divisionId: 'division-1' } }, { rondaPlayoff: { divisionId: 'division-1' } }],
            },
        });
        (0, vitest_1.expect)(mocks.update).toHaveBeenCalledWith('division-1', { usarPenalesEnEmpates: false }, tx);
    });
    (0, vitest_1.it)('bloquea cambiar la regla de penales después de finalizar un partido', async () => {
        mocks.divisionFindFirst.mockResolvedValue({
            id: 'division-1', ligaId: 'liga-1', canchaUnicaId: null,
            registrarParticipaciones: false, usarPenalesEnEmpates: true,
        });
        mocks.partidoCount.mockResolvedValue(1);
        await (0, vitest_1.expect)(service_1.divisionService.update('division-1', { usarPenalesEnEmpates: false }, owner))
            .rejects.toThrow('ya tiene partidos finalizados');
        (0, vitest_1.expect)(mocks.update).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('reautoriza después del lock y no escribe si cambió el propietario', async () => {
        mocks.divisionFindFirst
            .mockResolvedValueOnce({ id: 'division-1', ligaId: 'liga-1', canchaUnicaId: null, registrarParticipaciones: false })
            .mockResolvedValueOnce(null);
        await (0, vitest_1.expect)(service_1.divisionService.update('division-1', { registrarParticipaciones: true }, owner))
            .rejects.toMatchObject({ statusCode: 404 });
        (0, vitest_1.expect)(mocks.acquireLeagueScheduleLock).toHaveBeenCalledWith(tx, 'liga-1');
        (0, vitest_1.expect)(mocks.acquireLeagueScheduleLock.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.divisionFindFirst.mock.invocationCallOrder[1]);
        (0, vitest_1.expect)(mocks.update).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('bloquea origen y destino y rechaza una liga actual obsoleta antes de mover la división', async () => {
        mocks.divisionFindFirst
            .mockResolvedValueOnce({ id: 'division-1', ligaId: 'liga-1', canchaUnicaId: null, registrarParticipaciones: false })
            .mockResolvedValueOnce({ id: 'division-1', ligaId: 'liga-3', canchaUnicaId: null, registrarParticipaciones: false });
        await (0, vitest_1.expect)(service_1.divisionService.update('division-1', { ligaId: 'liga-2', registrarParticipaciones: true }, owner))
            .rejects.toMatchObject({ statusCode: 409 });
        (0, vitest_1.expect)(mocks.acquireLeagueScheduleLock.mock.calls).toEqual([[tx, 'liga-1'], [tx, 'liga-2']]);
        (0, vitest_1.expect)(mocks.update).not.toHaveBeenCalled();
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
        (0, vitest_1.expect)(mocks.cleanupUpsert).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(mocks.cleanupUpsert).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: { oneSignalId_tag: { oneSignalId: 'onesignal-1', tag: 'division_division-1' } },
            create: { oneSignalId: 'onesignal-1', tag: 'division_division-1', desired: false },
        }));
        (0, vitest_1.expect)(mocks.delete).toHaveBeenCalledWith('division-1', tx);
    });
    (0, vitest_1.it)('no elimina la división cuando falla la creación del lote de cleanup', async () => {
        mocks.subscriptionsFindMany.mockResolvedValue([{ oneSignalId: 'onesignal-1' }]);
        const failure = new Error('cleanup queue failed');
        mocks.cleanupUpsert.mockRejectedValue(failure);
        await (0, vitest_1.expect)(service_1.divisionService.delete('division-1', owner)).rejects.toBe(failure);
        (0, vitest_1.expect)(mocks.delete).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.transaction).toHaveBeenCalledOnce();
    });
    (0, vitest_1.it)('omite createMany si no hay suscriptores y conserva el presupuesto de consultas', async () => {
        await service_1.divisionService.delete('division-1', owner);
        (0, vitest_1.expect)(mocks.divisionFindFirst).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.subscriptionsFindMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(mocks.cleanupUpsert).not.toHaveBeenCalled();
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