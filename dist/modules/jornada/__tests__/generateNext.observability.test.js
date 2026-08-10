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
        (0, vitest_1.expect)(generateNextHarness_1.prisma.division.findUnique).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(generateNextHarness_1.prisma.rondaPlayoff.findFirst).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(generateNextHarness_1.jornadaRepository.findGenerationHistory).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(generateNextHarness_1.prisma.divisionEquipo.findMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(generateNextHarness_1.prisma.partido.findMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(generateNextHarness_1.prisma.$transaction).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(generateNextHarness_1.prisma.$executeRawUnsafe).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', 'liga-1');
        (0, vitest_1.expect)(generateNextHarness_1.prisma.partido.createMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(generateNextHarness_1.partidoRepository.findById).not.toHaveBeenCalled();
        (0, vitest_1.expect)(generateNextHarness_1.partidoRepository.create).toHaveBeenCalledTimes(3);
    });
    (0, vitest_1.it)('creates both notification audiences in the jornada transaction', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)(['t1', 't2']);
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(1);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId);
        (0, vitest_1.expect)(generateNextHarness_1.prisma.notificationOutbox.createMany).toHaveBeenCalledWith({
            data: [
                vitest_1.expect.objectContaining({ eventKey: 'jornada-generated:j-new-1:registered', audience: 'REGISTERED', jornadaId: 'j-new-1', divisionId: generateNextHarness_1.divisionId }),
                vitest_1.expect.objectContaining({ eventKey: 'jornada-generated:j-new-1:followers', audience: 'FOLLOWERS', jornadaId: 'j-new-1', divisionId: generateNextHarness_1.divisionId }),
            ],
            skipDuplicates: true,
        });
    });
});
//# sourceMappingURL=generateNext.observability.test.js.map