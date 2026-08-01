"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const generateNextHarness_1 = require("./support/generateNextHarness");
(0, vitest_1.beforeEach)(generateNextHarness_1.resetGenerateNextHarness);
(0, vitest_1.describe)('generateNext observability', () => {
    (0, vitest_1.it)('logs one structured completion event without generation diagnostics', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)(['t1', 't2']);
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(1);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId);
        (0, vitest_1.expect)(generateNextHarness_1.logger.info).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(generateNextHarness_1.logger.info).toHaveBeenCalledWith({
            divisionId: generateNextHarness_1.divisionId,
            jornadaId: 'j-new-1',
            counts: { created: 1, playoffUpdated: 0, total: 1 },
            durationMs: vitest_1.expect.any(Number),
        }, 'Jornada generation completed');
    });
    (0, vitest_1.it)('keeps the regular generation query budget constant and batches writes', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 6 });
        (0, generateNextHarness_1.mockTeams)(['t1', 't2', 't3', 't4', 't5', 't6']);
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId);
        (0, vitest_1.expect)(generateNextHarness_1.prisma.division.findUnique).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(generateNextHarness_1.prisma.rondaPlayoff.findFirst).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(generateNextHarness_1.jornadaRepository.findGenerationHistory).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(generateNextHarness_1.prisma.divisionEquipo.findMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(generateNextHarness_1.prisma.partido.findMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(generateNextHarness_1.prisma.$transaction).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(generateNextHarness_1.prisma.partido.createMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(generateNextHarness_1.partidoRepository.findById).not.toHaveBeenCalled();
        (0, vitest_1.expect)(generateNextHarness_1.partidoRepository.create).toHaveBeenCalledTimes(3);
    });
    (0, vitest_1.it)('handles detached notification rejection with a structured warning', async () => {
        const notificationError = new Error('push failed');
        generateNextHarness_1.notificationService.notifyJornadaGenerated.mockRejectedValue(notificationError);
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)(['t1', 't2']);
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(1);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId);
        await Promise.resolve();
        (0, vitest_1.expect)(generateNextHarness_1.logger.warn).toHaveBeenCalledWith({
            event: 'notification.failed',
            provider: 'onesignal',
            divisionId: generateNextHarness_1.divisionId,
            jornadaId: 'j-new-1',
        }, 'Jornada generation notification failed');
    });
});
//# sourceMappingURL=generateNext.observability.test.js.map