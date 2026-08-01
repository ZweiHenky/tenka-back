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
(0, vitest_1.describe)('partidoService public collections', () => {
    (0, vitest_1.it)('delegates the visible list to one repository operation with the actor', async () => {
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.list(service_test_harness_1.owner)).resolves.toEqual([service_test_harness_1.partido]);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findAllVisible).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findAllVisible).toHaveBeenCalledWith(service_test_harness_1.owner);
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.findMany).not.toHaveBeenCalled();
    });
    vitest_1.it.each([
        ['jornada', () => service_test_harness_1.partidoService.findByJornada('parent-1'), service_test_harness_1.partidoRepository.findVisibleByJornada, 'Jornada'],
        ['ronda playoff', () => service_test_harness_1.partidoService.findByRondaPlayoff('parent-1'), service_test_harness_1.partidoRepository.findVisibleByRondaPlayoff, 'Ronda playoff'],
    ])('returns an empty collection for a visible empty %s and 404 for a hidden or missing parent', async (_label, invoke, repositoryMethod, resource) => {
        vitest_1.vi.mocked(repositoryMethod).mockResolvedValueOnce([]).mockResolvedValueOnce(null);
        await (0, vitest_1.expect)(invoke()).resolves.toEqual([]);
        await (0, vitest_1.expect)(invoke()).rejects.toMatchObject({ statusCode: 404, message: `${resource} no encontrado` });
        (0, vitest_1.expect)(repositoryMethod).toHaveBeenCalledTimes(2);
    });
    (0, vitest_1.it)('passes the optional-auth actor to both parent visibility queries', async () => {
        await service_test_harness_1.partidoService.findByJornada('jornada-1', service_test_harness_1.owner);
        await service_test_harness_1.partidoService.findByRondaPlayoff('ronda-1', service_test_harness_1.admin);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findVisibleByJornada).toHaveBeenCalledWith('jornada-1', service_test_harness_1.owner);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findVisibleByRondaPlayoff).toHaveBeenCalledWith('ronda-1', service_test_harness_1.admin);
    });
});
(0, vitest_1.describe)('partidoService.getById', () => {
    (0, vitest_1.it)('loads the visible detail in a single repository call', async () => {
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.getById('partido-1', service_test_harness_1.owner)).resolves.toEqual(service_test_harness_1.partido);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findVisibleById).toHaveBeenCalledWith('partido-1', service_test_harness_1.owner);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findById).not.toHaveBeenCalled();
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findAuthorizationContext).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('hides missing or unauthorized matches as 404', async () => {
        vitest_1.vi.mocked(service_test_harness_1.partidoRepository.findVisibleById).mockResolvedValue(null);
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.getById('partido-hidden', service_test_harness_1.other)).rejects.toMatchObject({ statusCode: 404 });
    });
});
//# sourceMappingURL=service.read.test.js.map