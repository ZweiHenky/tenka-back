"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const mocks = vitest_1.vi.hoisted(() => {
    const tx = {
        rondaPlayoff: { findUnique: vitest_1.vi.fn(), findFirst: vitest_1.vi.fn() },
        partido: { findMany: vitest_1.vi.fn(), deleteMany: vitest_1.vi.fn(), updateMany: vitest_1.vi.fn() },
        partidoRefereeAccess: { deleteMany: vitest_1.vi.fn() },
        jornada: { delete: vitest_1.vi.fn() },
    };
    return { tx, transaction: vitest_1.vi.fn() };
});
vitest_1.vi.mock('../../../config/database', () => ({
    prisma: {
        $transaction: mocks.transaction,
    },
}));
vitest_1.vi.mock('../repository', () => ({
    jornadaRepository: {
        findDeleteContext: vitest_1.vi.fn(),
    },
}));
vitest_1.vi.mock('../../partido/repository', () => ({ partidoRepository: {} }));
vitest_1.vi.mock('../../tabla-posicion/service', () => ({
    tablaPosicionService: { recalcular: vitest_1.vi.fn() },
}));
vitest_1.vi.mock('../../notification/service', () => ({
    notificationService: { notifyJornadaGenerated: vitest_1.vi.fn() },
}));
const service_1 = require("../service");
const repository_1 = require("../repository");
const service_2 = require("../../tabla-posicion/service");
const owner = { id: 'user-1', email: 'owner@test.com', rol: 'LIGA' };
const semifinales = [
    {
        id: 'semi-1', rondaPlayoffId: 'ronda-semi', llave: 1, estado: 'FINALIZADO',
        golesLocal: 2, golesVisitante: 1, penalesLocal: null, penalesVisitante: null,
    },
    {
        id: 'semi-2', rondaPlayoffId: 'ronda-semi', llave: 2, estado: 'FINALIZADO',
        golesLocal: 1, golesVisitante: 1, penalesLocal: 4, penalesVisitante: 3,
    },
];
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback(mocks.tx));
    repository_1.jornadaRepository.findDeleteContext.mockResolvedValue({
        divisionId: 'div-1',
        latestJornadaId: 'j-semis',
        hasFinalizados: true,
        playoffPartidos: semifinales,
    });
    mocks.tx.rondaPlayoff.findUnique.mockResolvedValue({ divisionId: 'div-1', orden: 1 });
    mocks.tx.rondaPlayoff.findFirst.mockResolvedValue({ id: 'ronda-final' });
    mocks.tx.partido.findMany.mockResolvedValue([{ id: 'final-1', jornadaId: null }]);
});
(0, vitest_1.describe)('jornadaService.delete playoff rollback', () => {
    (0, vitest_1.it)('restores semifinales and deletes the derived final', async () => {
        await service_1.jornadaService.delete('j-semis', owner);
        (0, vitest_1.expect)(mocks.tx.partido.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['final-1'] } } });
        (0, vitest_1.expect)(mocks.tx.partidoRefereeAccess.deleteMany).toHaveBeenCalledWith({
            where: { partidoId: { in: ['semi-1', 'semi-2'] } },
        });
        (0, vitest_1.expect)(mocks.tx.partido.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['semi-1', 'semi-2'] } },
            data: {
                estado: 'PROGRAMADO',
                golesLocal: 0,
                golesVisitante: 0,
                penalesLocal: null,
                penalesVisitante: null,
                fecha: null,
                fechaFin: null,
                canchaId: null,
                jornadaId: null,
            },
        });
        (0, vitest_1.expect)(mocks.tx.jornada.delete).toHaveBeenCalledWith({ where: { id: 'j-semis' } });
        (0, vitest_1.expect)(service_2.tablaPosicionService.recalcular).toHaveBeenCalledWith('div-1');
        (0, vitest_1.expect)(repository_1.jornadaRepository.findDeleteContext).toHaveBeenCalledOnce();
    });
    (0, vitest_1.it)('rejects deletion when the derived match belongs to another jornada', async () => {
        mocks.tx.partido.findMany.mockResolvedValue([{ id: 'final-1', jornadaId: 'j-final' }]);
        await (0, vitest_1.expect)(service_1.jornadaService.delete('j-semis', owner)).rejects.toThrow('siguiente fase ya fue programada');
        (0, vitest_1.expect)(mocks.tx.partido.deleteMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.tx.partido.updateMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.tx.jornada.delete).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('restores a final without trying to delete a later phase', async () => {
        repository_1.jornadaRepository.findDeleteContext.mockResolvedValue({
            divisionId: 'div-1',
            latestJornadaId: 'j-final',
            hasFinalizados: true,
            playoffPartidos: [{ ...semifinales[0], id: 'final-1', rondaPlayoffId: 'ronda-final', llave: 1 }],
        });
        mocks.tx.rondaPlayoff.findUnique.mockResolvedValue({ divisionId: 'div-1', orden: 2 });
        mocks.tx.rondaPlayoff.findFirst.mockResolvedValue(null);
        await service_1.jornadaService.delete('j-final', owner);
        (0, vitest_1.expect)(mocks.tx.partido.deleteMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(mocks.tx.partido.updateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: { id: { in: ['final-1'] } },
        }));
    });
    (0, vitest_1.it)('returns 404 without opening a transaction when the jornada is not manageable', async () => {
        repository_1.jornadaRepository.findDeleteContext.mockResolvedValue(null);
        await (0, vitest_1.expect)(service_1.jornadaService.delete('hidden', owner)).rejects.toMatchObject({ statusCode: 404 });
        (0, vitest_1.expect)(mocks.transaction).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('enforces the latest-jornada rule from the narrow context', async () => {
        repository_1.jornadaRepository.findDeleteContext.mockResolvedValue({
            divisionId: 'div-1',
            latestJornadaId: 'j-newer',
            hasFinalizados: false,
            playoffPartidos: [],
        });
        await (0, vitest_1.expect)(service_1.jornadaService.delete('j-old', owner)).rejects.toThrow('última jornada');
        (0, vitest_1.expect)(mocks.transaction).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=delete.test.js.map