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
(0, vitest_1.describe)('partidoService private query budgets', () => {
    (0, vitest_1.it)('updates a jornada score with preflight and transactional authorization reads', async () => {
        const updated = { ...service_test_harness_1.partido, golesLocal: 2 };
        vitest_1.vi.mocked(service_test_harness_1.partidoRepository.update).mockResolvedValue(updated);
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { golesLocal: 2 }, service_test_harness_1.owner)).resolves.toEqual(updated);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findAuthorizationContext).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findAuthorizationContext).toHaveBeenNthCalledWith(2, 'partido-1', service_test_harness_1.prisma);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.update).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.update).toHaveBeenCalledWith('partido-1', { golesLocal: 2 }, service_test_harness_1.prisma);
        (0, vitest_1.expect)(service_test_harness_1.prisma.$transaction).toHaveBeenCalledWith(vitest_1.expect.any(Function), { isolationLevel: 'Serializable' });
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findById).not.toHaveBeenCalled();
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findVisibleById).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('deletes a jornada partido with preflight and transactional authorization reads', async () => {
        await service_test_harness_1.partidoService.delete('partido-1', service_test_harness_1.owner);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findAuthorizationContext).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findAuthorizationContext).toHaveBeenNthCalledWith(2, 'partido-1', service_test_harness_1.prisma);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.delete).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.delete).toHaveBeenCalledWith('partido-1', service_test_harness_1.prisma);
        (0, vitest_1.expect)(service_test_harness_1.prisma.$transaction).toHaveBeenCalledWith(vitest_1.expect.any(Function), { isolationLevel: 'Serializable' });
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findById).not.toHaveBeenCalled();
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findVisibleById).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('keeps all replacement reads except authorization preflight inside one transaction', async () => {
        await service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findAuthorizationContext).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findAuthorizationContext).toHaveBeenNthCalledWith(1, 'partido-1');
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findAuthorizationContext).toHaveBeenNthCalledWith(2, 'partido-1', service_test_harness_1.prisma);
        (0, vitest_1.expect)(service_test_harness_1.prisma.divisionEquipo.count).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.findMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.findFirst).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(service_test_harness_1.prisma.$transaction).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(service_test_harness_1.prisma.jornada.findMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(service_test_harness_1.prisma.jornada.findMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: { divisionId: 'division-1' },
        }));
        (0, vitest_1.expect)(service_test_harness_1.prisma.jornada.findUnique).not.toHaveBeenCalled();
        (0, vitest_1.expect)(service_test_harness_1.prisma.$executeRawUnsafe).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(vitest_1.vi.mocked(service_test_harness_1.prisma.$executeRawUnsafe).mock.invocationCallOrder[0])
            .toBeLessThan(vitest_1.vi.mocked(service_test_harness_1.partidoRepository.findAuthorizationContext).mock.invocationCallOrder[1]);
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.updateMany).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.findUnique).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(service_test_harness_1.prisma.$transaction).toHaveBeenCalledWith(vitest_1.expect.any(Function), { isolationLevel: 'Serializable' });
    });
});
//# sourceMappingURL=service.query-budget.test.js.map