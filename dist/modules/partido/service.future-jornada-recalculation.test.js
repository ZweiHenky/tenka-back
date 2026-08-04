"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
vitest_1.vi.mock('../../config/database', async () => (await Promise.resolve().then(() => __importStar(require('./service.test-mocks')))).databaseModuleMock);
vitest_1.vi.mock('./repository', async () => (await Promise.resolve().then(() => __importStar(require('./service.test-mocks')))).repositoryModuleMock);
vitest_1.vi.mock('../tabla-posicion/service', async () => (await Promise.resolve().then(() => __importStar(require('./service.test-mocks')))).tablaPosicionModuleMock);
vitest_1.vi.mock('../ronda-playoff/service', async () => (await Promise.resolve().then(() => __importStar(require('./service.test-mocks')))).rondaPlayoffModuleMock);
const service_test_harness_1 = require("./service.test-harness");
(0, vitest_1.beforeEach)(service_test_harness_1.resetServiceTestHarness);
(0, vitest_1.describe)('partidoService future jornada recalculation', () => {
    (0, vitest_1.it)('preserves future partido ids and reports recalculated jornadas', async () => {
        vitest_1.vi.mocked(service_test_harness_1.prisma.jornada.findMany)
            .mockReset()
            .mockResolvedValue([
            { id: 'jornada-1', numero: 1, partidos: [
                    { id: 'partido-1', estado: 'PROGRAMADO', fecha: service_test_harness_1.context.fecha, equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
                    { id: 'partido-2', estado: 'PROGRAMADO', fecha: new Date('2026-08-01T20:00:00Z'), equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
                ] },
            { id: 'jornada-2', numero: 2, partidos: [
                    { id: 'future-b', estado: 'PROGRAMADO', fecha: new Date('2026-08-08T20:00:00Z'), equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-3' },
                    { id: 'future-a', estado: 'PROGRAMADO', fecha: new Date('2026-08-08T18:00:00Z'), equipoLocalId: 'equipo-2', equipoVisitanteId: 'equipo-4' },
                ] },
        ]);
        const result = await service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner);
        (0, vitest_1.expect)(result.jornadasRecalculadas).toBe(1);
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.updateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ where: vitest_1.expect.objectContaining({ id: 'future-a' }) }));
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.updateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ where: vitest_1.expect.objectContaining({ id: 'future-b' }) }));
        const writeIds = vitest_1.vi.mocked(service_test_harness_1.prisma.partido.updateMany).mock.calls.map(([query]) => query.where.id);
        (0, vitest_1.expect)(writeIds).toEqual([...writeIds].sort((a, b) => a.localeCompare(b)));
    });
    (0, vitest_1.it)('blocks a future regular match that is not programmed before writes', async () => {
        vitest_1.vi.mocked(service_test_harness_1.prisma.jornada.findMany).mockReset().mockResolvedValueOnce([
            { id: 'jornada-1', numero: 1, partidos: [
                    { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
                    { id: 'partido-2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
                ] },
            { id: 'jornada-2', numero: 2, partidos: [{ id: 'future', estado: 'FINALIZADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-4' }] },
        ]);
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner))
            .rejects.toThrow('jornadas posteriores deben estar programados');
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.updateMany).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('repeats a future pairing instead of failing when all options are exhausted', async () => {
        vitest_1.vi.mocked(service_test_harness_1.prisma.jornada.findMany).mockReset()
            .mockResolvedValue([
            { id: 'jornada-0', numero: 0, partidos: [
                    { id: 'history', estado: 'FINALIZADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-3' },
                ] },
            { id: 'jornada-1', numero: 1, partidos: [
                    { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
                    { id: 'partido-2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
                ] },
            { id: 'jornada-2', numero: 2, partidos: [{ id: 'future', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-3' }] },
        ]);
        const result = await service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner);
        (0, vitest_1.expect)(result.jornadasRecalculadas).toBe(1);
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.updateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: vitest_1.expect.objectContaining({ id: 'future' }),
            data: { equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-3' },
        }));
    });
    (0, vitest_1.it)('prefers the globally least-used perfect matching for a future jornada', async () => {
        vitest_1.vi.mocked(service_test_harness_1.prisma.jornada.findMany).mockReset().mockResolvedValue([
            { id: 'history-1', numero: -2, partidos: [
                    { id: 'h1', estado: 'FINALIZADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
                    { id: 'h2', estado: 'FINALIZADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-4' },
                    { id: 'h3', estado: 'FINALIZADO', equipoLocalId: 'equipo-2', equipoVisitanteId: 'equipo-3' },
                ] },
            { id: 'history-2', numero: -1, partidos: [
                    { id: 'h4', estado: 'FINALIZADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
                    { id: 'h5', estado: 'FINALIZADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-4' },
                    { id: 'h6', estado: 'FINALIZADO', equipoLocalId: 'equipo-2', equipoVisitanteId: 'equipo-3' },
                ] },
            { id: 'jornada-1', numero: 1, partidos: [
                    { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
                    { id: 'partido-2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
                ] },
            { id: 'jornada-2', numero: 2, partidos: [
                    { id: 'future-a', estado: 'PROGRAMADO', fecha: new Date('2026-08-08T18:00:00Z'), equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-3' },
                    { id: 'future-b', estado: 'PROGRAMADO', fecha: new Date('2026-08-08T20:00:00Z'), equipoLocalId: 'equipo-2', equipoVisitanteId: 'equipo-4' },
                ] },
        ]);
        await service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner);
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.updateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: vitest_1.expect.objectContaining({ id: 'future-a' }),
            data: { equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-3' },
        }));
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.updateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: vitest_1.expect.objectContaining({ id: 'future-b' }),
            data: { equipoLocalId: 'equipo-2', equipoVisitanteId: 'equipo-4' },
        }));
    });
    (0, vitest_1.it)('aborts without writes when the target changes after the preflight read', async () => {
        vitest_1.vi.mocked(service_test_harness_1.prisma.jornada.findMany).mockResolvedValue([{
                id: 'jornada-1', numero: 1, partidos: [
                    { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
                    { id: 'partido-2', estado: 'FINALIZADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
                ],
            }]);
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner))
            .rejects.toThrow('El partido del equipo seleccionado debe estar programado');
        (0, vitest_1.expect)(service_test_harness_1.prisma.$transaction).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.updateMany).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('derives the target and participants from the transactional jornada snapshot', async () => {
        vitest_1.vi.mocked(service_test_harness_1.prisma.jornada.findMany).mockResolvedValue([{
                id: 'jornada-1', numero: 1, partidos: [
                    { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
                    { id: 'partido-2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-4', equipoVisitanteId: 'equipo-3' },
                ],
            }]);
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner)).resolves.toBeDefined();
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.updateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: vitest_1.expect.objectContaining({ id: 'partido-2', equipoLocalId: 'equipo-4', equipoVisitanteId: 'equipo-3' }),
            data: { equipoLocalId: 'equipo-4', equipoVisitanteId: 'equipo-1' },
        }));
    });
    (0, vitest_1.it)('retries the full serializable transaction after a conditional plan goes stale', async () => {
        vitest_1.vi.mocked(service_test_harness_1.prisma.partido.updateMany).mockResolvedValueOnce({ count: 0 }).mockResolvedValue({ count: 1 });
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner)).resolves.toBeDefined();
        (0, vitest_1.expect)(service_test_harness_1.prisma.$transaction).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(service_test_harness_1.prisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findAuthorizationContext).toHaveBeenCalledTimes(3);
    });
    (0, vitest_1.it)('maps exhausted serialization retries to a 409 conflict', async () => {
        vitest_1.vi.mocked(service_test_harness_1.prisma.$transaction).mockRejectedValue(Object.assign(new Error('serialization failure'), { code: 'P2034' }));
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner))
            .rejects.toMatchObject({ statusCode: 409 });
        (0, vitest_1.expect)(service_test_harness_1.prisma.$transaction).toHaveBeenCalledTimes(3);
    });
    (0, vitest_1.it)('maps three stale conditional plans to a 409 conflict', async () => {
        vitest_1.vi.mocked(service_test_harness_1.prisma.partido.updateMany).mockResolvedValue({ count: 0 });
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner))
            .rejects.toMatchObject({ statusCode: 409 });
        (0, vitest_1.expect)(service_test_harness_1.prisma.$transaction).toHaveBeenCalledTimes(3);
        (0, vitest_1.expect)(service_test_harness_1.prisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
    });
});
//# sourceMappingURL=service.future-jornada-recalculation.test.js.map