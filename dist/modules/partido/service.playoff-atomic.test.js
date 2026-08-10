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
const service_1 = require("../ronda-playoff/service");
const service_test_harness_1 = require("./service.test-harness");
const playoffContext = {
    ...service_test_harness_1.context,
    jornadaId: null,
    rondaPlayoffId: 'round-1',
    tipoPartido: 'ELIMINATORIA',
};
(0, vitest_1.beforeEach)(() => {
    (0, service_test_harness_1.resetServiceTestHarness)();
    vitest_1.vi.mocked(service_test_harness_1.partidoRepository.findAuthorizationContext).mockResolvedValue(playoffContext);
    vitest_1.vi.mocked(service_1.rondaPlayoffService.syncAdvancement).mockResolvedValue(undefined);
});
(0, vitest_1.describe)('partidoService atomic playoff orchestration', () => {
    (0, vitest_1.it)('updates a playoff result and synchronizes advancement in the same locked transaction', async () => {
        const updated = { ...service_test_harness_1.partido, ...playoffContext, estado: 'FINALIZADO', golesLocal: 2 };
        vitest_1.vi.mocked(service_test_harness_1.partidoRepository.update).mockResolvedValue(updated);
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { estado: 'FINALIZADO', golesLocal: 2 }, service_test_harness_1.owner)).resolves.toBe(updated);
        (0, vitest_1.expect)(service_test_harness_1.prisma.$transaction).toHaveBeenCalledWith(vitest_1.expect.any(Function), { isolationLevel: 'Serializable' });
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.update).toHaveBeenCalledWith('partido-1', { estado: 'FINALIZADO', golesLocal: 2, version: { increment: 1 } }, service_test_harness_1.prisma);
        (0, vitest_1.expect)(service_1.rondaPlayoffService.syncAdvancement).toHaveBeenCalledWith(service_test_harness_1.prisma, 'round-1');
        (0, vitest_1.expect)(service_1.rondaPlayoffService.advanceWinners).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('does not commit a playoff result when advancement synchronization fails', async () => {
        const events = [];
        vitest_1.vi.mocked(service_test_harness_1.partidoRepository.update).mockImplementation(async () => {
            events.push('update');
            return { ...service_test_harness_1.partido, ...playoffContext, estado: 'FINALIZADO', golesLocal: 1 };
        });
        vitest_1.vi.mocked(service_1.rondaPlayoffService.syncAdvancement).mockImplementation(async () => {
            events.push('sync');
            throw new Error('injected advancement failure');
        });
        vitest_1.vi.mocked(service_test_harness_1.prisma.$transaction).mockImplementation(async (callback) => {
            events.push('begin');
            const result = await callback(service_test_harness_1.prisma);
            events.push('commit');
            return result;
        });
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { estado: 'FINALIZADO', golesLocal: 1 }, service_test_harness_1.owner))
            .rejects.toThrow('injected advancement failure');
        (0, vitest_1.expect)(events).toEqual(['begin', 'update', 'sync']);
    });
    (0, vitest_1.it)('deletes a playoff match and reverses its advancement before commit', async () => {
        const deleted = { ...service_test_harness_1.partido, ...playoffContext };
        vitest_1.vi.mocked(service_test_harness_1.partidoRepository.delete).mockResolvedValue(deleted);
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.delete('partido-1', service_test_harness_1.owner)).resolves.toBe(deleted);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.delete).toHaveBeenCalledWith('partido-1', service_test_harness_1.prisma);
        (0, vitest_1.expect)(service_1.rondaPlayoffService.syncAdvancement).toHaveBeenCalledWith(service_test_harness_1.prisma, 'round-1');
        (0, vitest_1.expect)(vitest_1.vi.mocked(service_test_harness_1.partidoRepository.delete).mock.invocationCallOrder[0])
            .toBeLessThan(vitest_1.vi.mocked(service_1.rondaPlayoffService.syncAdvancement).mock.invocationCallOrder[0]);
    });
    (0, vitest_1.it)('does not commit a playoff delete when advancement reversal is rejected', async () => {
        const events = [];
        vitest_1.vi.mocked(service_test_harness_1.partidoRepository.delete).mockImplementation(async () => {
            events.push('delete');
            return { ...service_test_harness_1.partido, ...playoffContext };
        });
        vitest_1.vi.mocked(service_1.rondaPlayoffService.syncAdvancement).mockImplementation(async () => {
            events.push('sync');
            throw new Error('protected derived match');
        });
        vitest_1.vi.mocked(service_test_harness_1.prisma.$transaction).mockImplementation(async (callback) => {
            events.push('begin');
            const result = await callback(service_test_harness_1.prisma);
            events.push('commit');
            return result;
        });
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.delete('partido-1', service_test_harness_1.owner)).rejects.toThrow('protected derived match');
        (0, vitest_1.expect)(events).toEqual(['begin', 'delete', 'sync']);
    });
});
//# sourceMappingURL=service.playoff-atomic.test.js.map