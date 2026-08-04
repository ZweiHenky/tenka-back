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
(0, vitest_1.describe)('partidoService.update team replacement', () => {
    (0, vitest_1.it)('does not apply replacement checks to score/result updates', async () => {
        await service_test_harness_1.partidoService.update('partido-1', { golesLocal: 2 }, service_test_harness_1.owner);
        (0, vitest_1.expect)(service_test_harness_1.prisma.divisionEquipo.count).not.toHaveBeenCalled();
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.findFirst).not.toHaveBeenCalled();
        (0, vitest_1.expect)(service_test_harness_1.prisma.equipo.findMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(service_test_harness_1.prisma.$executeRaw).not.toHaveBeenCalled();
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.update).toHaveBeenCalledWith('partido-1', { golesLocal: 2 }, service_test_harness_1.prisma);
    });
    (0, vitest_1.it)('swaps teams while preserving each selected side', async () => {
        await service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner);
        (0, vitest_1.expect)(service_test_harness_1.prisma.divisionEquipo.count).toHaveBeenCalledWith({
            where: { divisionId: 'division-1', equipoId: 'equipo-3' },
        });
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.findMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.updateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: vitest_1.expect.objectContaining({ id: 'partido-2', estado: 'PROGRAMADO', jornadaId: 'jornada-1', tipoPartido: 'REGULAR' }),
            data: { equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-4' },
        }));
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.updateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: vitest_1.expect.objectContaining({ id: 'partido-1', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' }),
            data: { equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-2' },
        }));
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.findFirst).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.findFirst).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: vitest_1.expect.objectContaining({ id: { notIn: ['partido-1', 'partido-2'] } }),
        }));
        (0, vitest_1.expect)(service_test_harness_1.prisma.equipo.findMany).toHaveBeenCalledWith({
            where: { id: { in: ['equipo-1', 'equipo-2', 'equipo-3', 'equipo-4'] } },
            select: { userId: true },
        });
        (0, vitest_1.expect)(service_test_harness_1.prisma.$executeRaw).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(vitest_1.vi.mocked(service_test_harness_1.prisma.partido.updateMany).mock.invocationCallOrder.at(-1))
            .toBeLessThan(vitest_1.vi.mocked(service_test_harness_1.prisma.$executeRaw).mock.invocationCallOrder[0]);
    });
    (0, vitest_1.it)('fails the swap transaction when the schedule outbox cannot be written', async () => {
        vitest_1.vi.mocked(service_test_harness_1.prisma.$executeRaw).mockRejectedValueOnce(new Error('outbox unavailable'));
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner))
            .rejects.toThrow('outbox unavailable');
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.updateMany).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.findUnique).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('allows the resulting unordered pair when it occurred in a prior jornada', async () => {
        vitest_1.vi.mocked(service_test_harness_1.prisma.jornada.findMany).mockResolvedValue([
            { id: 'jornada-0', numero: 0, partidos: [
                    { id: 'history', estado: 'FINALIZADO', equipoLocalId: 'equipo-2', equipoVisitanteId: 'equipo-3' },
                ] },
            { id: 'jornada-1', numero: 1, partidos: [
                    { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
                    { id: 'partido-2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
                ] },
        ]);
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner)).resolves.toBeDefined();
    });
    vitest_1.it.each([
        ['same order', 'equipo-3', 'equipo-2'],
        ['reversed order', 'equipo-2', 'equipo-3'],
    ])('rejects an ambiguous incoming-team appearance before duplicate-pair matching: %s', async (_label, local, visitor) => {
        vitest_1.vi.mocked(service_test_harness_1.prisma.jornada.findMany).mockResolvedValue([{ id: 'jornada-1', numero: 1, partidos: [
                    { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
                    { id: 'partido-2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
                    { id: 'duplicate', estado: 'PROGRAMADO', equipoLocalId: local, equipoVisitanteId: visitor },
                ] }]);
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner))
            .rejects.toThrow('intercambio es ambiguo');
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.updateMany).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('blocks when the incoming team has no match in the jornada', async () => {
        vitest_1.vi.mocked(service_test_harness_1.prisma.jornada.findMany).mockResolvedValue([{ id: 'jornada-1', numero: 1, partidos: [
                    { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
                ] }]);
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner))
            .rejects.toThrow('no tiene otro partido en esta jornada');
    });
    (0, vitest_1.it)('blocks an ambiguous incoming team appearance', async () => {
        vitest_1.vi.mocked(service_test_harness_1.prisma.jornada.findMany).mockResolvedValue([{ id: 'jornada-1', numero: 1, partidos: [
                    { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
                    { id: 'p2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
                    { id: 'p3', estado: 'PROGRAMADO', equipoLocalId: 'equipo-5', equipoVisitanteId: 'equipo-3' },
                ] }]);
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner))
            .rejects.toThrow('intercambio es ambiguo');
    });
    (0, vitest_1.it)('blocks a target match that is not PROGRAMADO', async () => {
        vitest_1.vi.mocked(service_test_harness_1.prisma.jornada.findMany).mockResolvedValue([{ id: 'jornada-1', numero: 1, partidos: [
                    { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
                    { id: 'partido-2', estado: 'FINALIZADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-4' },
                ] }]);
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner))
            .rejects.toThrow('partido del equipo seleccionado debe estar programado');
    });
    (0, vitest_1.it)('rejects replacement unless the match is PROGRAMADO', async () => {
        vitest_1.vi.mocked(service_test_harness_1.partidoRepository.findAuthorizationContext).mockResolvedValue({ ...service_test_harness_1.context, estado: null });
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner))
            .rejects.toThrow('Solo se pueden reemplazar equipos en partidos programados');
    });
    (0, vitest_1.it)('rejects playoff matches', async () => {
        vitest_1.vi.mocked(service_test_harness_1.partidoRepository.findAuthorizationContext).mockResolvedValue({
            ...service_test_harness_1.context,
            jornadaId: null,
            rondaPlayoffId: 'ronda-1',
        });
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner))
            .rejects.toThrow('Solo se pueden reemplazar equipos en partidos regulares de jornada');
    });
    (0, vitest_1.it)('rejects a team outside the jornada division', async () => {
        vitest_1.vi.mocked(service_test_harness_1.prisma.divisionEquipo.count).mockResolvedValue(0);
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner))
            .rejects.toThrow('El equipo de reemplazo no pertenece a la división de la jornada');
    });
    (0, vitest_1.it)('rejects making local and visitor the same team', async () => {
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-2' }, service_test_harness_1.owner))
            .rejects.toThrow('El equipo local y visitante deben ser diferentes');
    });
    (0, vitest_1.it)('rejects when the outgoing team would face itself in the target match', async () => {
        vitest_1.vi.mocked(service_test_harness_1.prisma.jornada.findMany).mockResolvedValue([{ id: 'jornada-1', numero: 1, partidos: [
                    { id: 'partido-1', estado: 'PROGRAMADO', equipoLocalId: 'equipo-1', equipoVisitanteId: 'equipo-2' },
                    { id: 'partido-2', estado: 'PROGRAMADO', equipoLocalId: 'equipo-3', equipoVisitanteId: 'equipo-1', fecha: new Date('2026-08-01T20:00:00Z'), fechaFin: new Date('2026-08-01T21:00:00Z') },
                ] }]);
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner))
            .rejects.toThrow('mismo equipo como local y visitante');
    });
    (0, vitest_1.it)('rejects an overlapping match in the same division', async () => {
        vitest_1.vi.mocked(service_test_harness_1.prisma.partido.findFirst).mockResolvedValue({ id: 'other-match' });
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoVisitanteId: 'equipo-3' }, service_test_harness_1.owner))
            .rejects.toThrow('Uno de los equipos ya tiene un partido en el horario resultante');
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.findFirst).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: vitest_1.expect.objectContaining({
                id: { notIn: ['partido-1', 'partido-2'] },
                AND: vitest_1.expect.arrayContaining([{ OR: [
                            { jornada: { divisionId: 'division-1' } },
                            { rondaPlayoff: { divisionId: 'division-1' } },
                        ] }]),
            }),
        }));
    });
    (0, vitest_1.it)('checks both resulting intervals in one conflict query', async () => {
        vitest_1.vi.mocked(service_test_harness_1.prisma.partido.findFirst).mockResolvedValue({ id: 'other-match' });
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.owner))
            .rejects.toThrow('Uno de los equipos ya tiene un partido en el horario resultante');
        (0, vitest_1.expect)(service_test_harness_1.prisma.partido.findFirst).toHaveBeenCalledOnce();
        const intervalPredicates = vitest_1.vi.mocked(service_test_harness_1.prisma.partido.findFirst).mock.calls[0][0].where.AND[1].OR;
        (0, vitest_1.expect)(intervalPredicates).toEqual([
            {
                fecha: { lt: service_test_harness_1.context.fechaFin },
                fechaFin: { gt: service_test_harness_1.context.fecha },
                OR: [{ equipoLocalId: 'equipo-3' }, { equipoVisitanteId: 'equipo-3' }],
            },
            {
                fecha: { lt: new Date('2026-08-01T21:00:00Z') },
                fechaFin: { gt: new Date('2026-08-01T20:00:00Z') },
                OR: [{ equipoLocalId: 'equipo-1' }, { equipoVisitanteId: 'equipo-1' }],
            },
        ]);
        (0, vitest_1.expect)(service_test_harness_1.prisma.$transaction).toHaveBeenCalledOnce();
    });
    (0, vitest_1.it)('keeps owner authorization before replacement validation', async () => {
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3' }, service_test_harness_1.other))
            .rejects.toMatchObject({ statusCode: 404 });
        (0, vitest_1.expect)(service_test_harness_1.prisma.divisionEquipo.count).not.toHaveBeenCalled();
    });
    vitest_1.it.each(['golesLocal', 'golesVisitante', 'penalesLocal', 'penalesVisitante', 'estado', 'jornadaId', 'rondaPlayoffId', 'tipoPartido'])('rejects replacement mixed with %s before opening a transaction', async (field) => {
        await (0, vitest_1.expect)(service_test_harness_1.partidoService.update('partido-1', { equipoLocalId: 'equipo-3', [field]: field === 'estado' ? 'PROGRAMADO' : 1 }, service_test_harness_1.owner))
            .rejects.toThrow('No se puede combinar el reemplazo de equipo');
        (0, vitest_1.expect)(service_test_harness_1.prisma.$transaction).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('allows an administrator to update a foreign partido', async () => {
        await service_test_harness_1.partidoService.update('partido-1', { golesLocal: 2 }, service_test_harness_1.admin);
        (0, vitest_1.expect)(service_test_harness_1.partidoRepository.update).toHaveBeenCalled();
    });
});
//# sourceMappingURL=service.team-replacement.test.js.map