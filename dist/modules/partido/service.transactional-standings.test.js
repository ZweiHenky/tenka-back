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
const resultWriterMocks = vitest_1.vi.hoisted(() => ({ writeResultInTransaction: vitest_1.vi.fn() }));
vitest_1.vi.mock('./resultWriter', () => ({
    getResultContext: vitest_1.vi.fn(),
    writeResultInTransaction: resultWriterMocks.writeResultInTransaction,
}));
const service_test_harness_1 = require("./service.test-harness");
(0, vitest_1.beforeEach)(() => {
    (0, service_test_harness_1.resetServiceTestHarness)();
    resultWriterMocks.writeResultInTransaction.mockReset().mockResolvedValue(service_test_harness_1.partido);
});
(0, vitest_1.describe)('partidoService transactional standings orchestration', () => {
    (0, vitest_1.it)('uses ReadCommitted and reauthorizes after the owner result lock', async () => {
        await service_test_harness_1.partidoService.updateResult('partido-1', {
            expectedVersion: 0, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0, allocations: [],
        }, service_test_harness_1.owner);
        (0, vitest_1.expect)(service_test_harness_1.prisma.$transaction).toHaveBeenCalledWith(vitest_1.expect.any(Function), { isolationLevel: 'ReadCommitted' });
        (0, vitest_1.expect)(vitest_1.vi.mocked(service_test_harness_1.prisma.$executeRawUnsafe).mock.invocationCallOrder[0])
            .toBeLessThan(vitest_1.vi.mocked(service_test_harness_1.partidoRepository.findAuthorizationContext).mock.invocationCallOrder[1]);
        (0, vitest_1.expect)(vitest_1.vi.mocked(service_test_harness_1.partidoRepository.findAuthorizationContext).mock.invocationCallOrder[1])
            .toBeLessThan(resultWriterMocks.writeResultInTransaction.mock.invocationCallOrder[0]);
    });
    (0, vitest_1.it)('rejects an owner result when post-lock ownership changed', async () => {
        vitest_1.vi.mocked(service_test_harness_1.partidoRepository.findAuthorizationContext)
            .mockResolvedValueOnce(service_test_harness_1.context)
            .mockResolvedValueOnce({ ...service_test_harness_1.context, ligaUserId: 'other-owner' });
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.updateResult('partido-1', {
            expectedVersion: 0, estado: 'FINALIZADO', golesLocal: 1, golesVisitante: 0, allocations: [],
        }, service_test_harness_1.owner)).rejects.toMatchObject({ statusCode: 404 });
        (0, vitest_1.expect)(resultWriterMocks.writeResultInTransaction).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('uses the same Serializable transaction for lock, reread, result update, and standings', async () => {
        const tx = {
            $executeRawUnsafe: vitest_1.vi.fn().mockResolvedValue(0),
            jornada: { findUnique: vitest_1.vi.fn().mockResolvedValue({ divisionId: 'division-1' }) },
        };
        vitest_1.vi.mocked(service_test_harness_1.prisma.$transaction).mockImplementation(async (callback) => callback(tx));
        vitest_1.vi.mocked(service_test_harness_1.partidoRepository.update).mockResolvedValue({ ...service_test_harness_1.partido, estado: 'FINALIZADO', golesLocal: 2 });
        await service_test_harness_1.partidoService.update('partido-1', { estado: 'FINALIZADO', golesLocal: 2 }, service_test_harness_1.owner);
        (0, vitest_1.expect)(service_test_harness_1.prisma.$transaction).toHaveBeenCalledWith(vitest_1.expect.any(Function), { isolationLevel: 'Serializable' });
        (0, vitest_1.expect)(tx.$executeRawUnsafe).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', 'liga-1');
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findAuthorizationContext).toHaveBeenNthCalledWith(2, 'partido-1', tx);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.update).toHaveBeenCalledWith('partido-1', { estado: 'FINALIZADO', golesLocal: 2, version: { increment: 1 } }, tx);
        (0, vitest_1.expect)(service_test_harness_1.tablaPosicionService.recalcular).toHaveBeenCalledWith('division-1', tx);
        (0, vitest_1.expect)(tx.$executeRawUnsafe.mock.invocationCallOrder[0])
            .toBeLessThan(vitest_1.vi.mocked(service_test_harness_1.partidoRepository.update).mock.invocationCallOrder[0]);
        (0, vitest_1.expect)(vitest_1.vi.mocked(service_test_harness_1.partidoRepository.update).mock.invocationCallOrder[0])
            .toBeLessThan(vitest_1.vi.mocked(service_test_harness_1.tablaPosicionService.recalcular).mock.invocationCallOrder[0]);
    });
    (0, vitest_1.it)('retries the complete result operation up to three times on P2034', async () => {
        const serializationFailure = Object.assign(new Error('serialization failure'), { code: 'P2034' });
        vitest_1.vi.mocked(service_test_harness_1.partidoRepository.update).mockResolvedValue({ ...service_test_harness_1.partido, estado: 'FINALIZADO' });
        vitest_1.vi.mocked(service_test_harness_1.tablaPosicionService.recalcular)
            .mockRejectedValueOnce(serializationFailure)
            .mockRejectedValueOnce(serializationFailure)
            .mockResolvedValueOnce(undefined);
        await service_test_harness_1.partidoService.update('partido-1', { estado: 'FINALIZADO' }, service_test_harness_1.owner);
        (0, vitest_1.expect)(service_test_harness_1.prisma.$transaction).toHaveBeenCalledTimes(3);
        (0, vitest_1.expect)(service_test_harness_1.prisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findAuthorizationContext).toHaveBeenCalledTimes(4);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.update).toHaveBeenCalledTimes(3);
        (0, vitest_1.expect)(service_test_harness_1.tablaPosicionService.recalcular).toHaveBeenCalledTimes(3);
    });
    (0, vitest_1.it)('stops after three failed serialization attempts', async () => {
        const serializationFailure = Object.assign(new Error('serialization failure'), { code: 'P2034' });
        vitest_1.vi.mocked(service_test_harness_1.partidoRepository.update).mockResolvedValue({ ...service_test_harness_1.partido, estado: 'FINALIZADO' });
        vitest_1.vi.mocked(service_test_harness_1.tablaPosicionService.recalcular).mockRejectedValue(serializationFailure);
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { estado: 'FINALIZADO' }, service_test_harness_1.owner))
            .rejects.toBe(serializationFailure);
        (0, vitest_1.expect)(service_test_harness_1.prisma.$transaction).toHaveBeenCalledTimes(3);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.update).toHaveBeenCalledTimes(3);
        (0, vitest_1.expect)(service_test_harness_1.tablaPosicionService.recalcular).toHaveBeenCalledTimes(3);
    });
    (0, vitest_1.it)('does not reach transaction commit when standings recalculation fails', async () => {
        const events = [];
        vitest_1.vi.mocked(service_test_harness_1.partidoRepository.update).mockImplementation(async () => {
            events.push('update');
            return { ...service_test_harness_1.partido, estado: 'FINALIZADO' };
        });
        vitest_1.vi.mocked(service_test_harness_1.tablaPosicionService.recalcular).mockImplementation(async () => {
            events.push('recalculate');
            throw new Error('injected standings failure');
        });
        vitest_1.vi.mocked(service_test_harness_1.prisma.$transaction).mockImplementation(async (callback) => {
            events.push('begin');
            const result = await callback(service_test_harness_1.prisma);
            events.push('commit');
            return result;
        });
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { estado: 'FINALIZADO' }, service_test_harness_1.owner))
            .rejects.toThrow('injected standings failure');
        (0, vitest_1.expect)(events).toEqual(['begin', 'update', 'recalculate']);
    });
    (0, vitest_1.it)('returns the exposed deleted partido and recalculates before the same transaction commits', async () => {
        const deleted = { ...service_test_harness_1.partido, estado: 'FINALIZADO', arbitros: [{ id: 'ref-1', nombre: 'Ref' }] };
        vitest_1.vi.mocked(service_test_harness_1.partidoRepository.findAuthorizationContext).mockResolvedValue({ ...service_test_harness_1.context, estado: 'FINALIZADO' });
        vitest_1.vi.mocked(service_test_harness_1.partidoRepository.delete).mockResolvedValue(deleted);
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.delete('partido-1', service_test_harness_1.owner)).resolves.toBe(deleted);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.findAuthorizationContext).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.delete).toHaveBeenCalledWith('partido-1', service_test_harness_1.prisma);
        (0, vitest_1.expect)(service_test_harness_1.tablaPosicionService.recalcular).toHaveBeenCalledWith('division-1', service_test_harness_1.prisma);
        (0, vitest_1.expect)(service_test_harness_1.prisma.$transaction).toHaveBeenCalledWith(vitest_1.expect.any(Function), { isolationLevel: 'Serializable' });
        (0, vitest_1.expect)(vitest_1.vi.mocked(service_test_harness_1.partidoRepository.delete).mock.invocationCallOrder[0])
            .toBeLessThan(vitest_1.vi.mocked(service_test_harness_1.tablaPosicionService.recalcular).mock.invocationCallOrder[0]);
    });
    (0, vitest_1.it)('does not commit a delete when standings recalculation fails', async () => {
        const events = [];
        vitest_1.vi.mocked(service_test_harness_1.partidoRepository.findAuthorizationContext).mockResolvedValue({ ...service_test_harness_1.context, estado: 'FINALIZADO' });
        vitest_1.vi.mocked(service_test_harness_1.partidoRepository.delete).mockImplementation(async () => {
            events.push('delete');
            return service_test_harness_1.partido;
        });
        vitest_1.vi.mocked(service_test_harness_1.tablaPosicionService.recalcular).mockImplementation(async () => {
            events.push('recalculate');
            throw new Error('injected standings failure');
        });
        vitest_1.vi.mocked(service_test_harness_1.prisma.$transaction).mockImplementation(async (callback) => {
            events.push('begin');
            const result = await callback(service_test_harness_1.prisma);
            events.push('commit');
            return result;
        });
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.delete('partido-1', service_test_harness_1.owner))
            .rejects.toThrow('injected standings failure');
        (0, vitest_1.expect)(events).toEqual(['begin', 'delete', 'recalculate']);
    });
});
//# sourceMappingURL=service.transactional-standings.test.js.map