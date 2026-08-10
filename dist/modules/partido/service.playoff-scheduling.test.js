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
const playoff = {
    ...service_test_harness_1.context,
    jornadaId: null,
    rondaPlayoffId: 'round-1',
    tipoPartido: 'ELIMINATORIA',
};
(0, vitest_1.beforeEach)(() => {
    (0, service_test_harness_1.resetServiceTestHarness)();
    vitest_1.vi.mocked(service_test_harness_1.partidoRepository.findAuthorizationContext).mockResolvedValue(playoff);
    vitest_1.vi.mocked(service_test_harness_1.partidoRepository.update).mockResolvedValue({ ...service_test_harness_1.partido, ...playoff, estado: 'FINALIZADO', golesLocal: 1 });
});
(0, vitest_1.describe)('partidoService playoff finalization schedule', () => {
    vitest_1.it.each([
        ['missing dates', { fecha: null, fechaFin: null }, 'primero genera la jornada'],
        ['invalid interval', { fechaFin: playoff.fecha }, 'primero genera la jornada'],
        ['multiple-court missing court', { multiplesCanchas: true, canchaId: null }, 'sin cancha'],
    ])('rejects %s from the locked persisted context', async (_case, override, message) => {
        vitest_1.vi.mocked(service_test_harness_1.partidoRepository.findAuthorizationContext).mockResolvedValue({ ...playoff, ...override });
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { estado: 'FINALIZADO', golesLocal: 1 }, service_test_harness_1.owner))
            .rejects.toThrow(message);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.update).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('allows a null court for a single-court league', async () => {
        const updated = { ...service_test_harness_1.partido, ...playoff, estado: 'FINALIZADO', golesLocal: 1 };
        vitest_1.vi.mocked(service_test_harness_1.partidoRepository.update).mockResolvedValue(updated);
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { estado: 'FINALIZADO', golesLocal: 1 }, service_test_harness_1.owner))
            .resolves.toBe(updated);
    });
});
//# sourceMappingURL=service.playoff-scheduling.test.js.map