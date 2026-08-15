"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const generateNextHarness_1 = require("./support/generateNextHarness");
(0, vitest_1.beforeEach)(generateNextHarness_1.resetGenerateNextHarness);
const slot = {
    fecha: '2099-01-01',
    horaInicio: '18:00',
    horaFin: '19:00',
    equipoLocalId: 't1',
    equipoVisitanteId: 't2',
};
function arrange(multiplesCanchas = false) {
    (0, generateNextHarness_1.mockDivision)({ duracionPartido: 60, multiplesCanchas });
    (0, generateNextHarness_1.mockTeams)(['t1', 't2']);
    (0, generateNextHarness_1.mockNoPreviousJornadas)();
    (0, generateNextHarness_1.mockJornadaCreated)();
    if (multiplesCanchas) {
        generateNextHarness_1.prisma.ligaCancha.findMany.mockResolvedValue([
            { id: 'c1', nombre: 'Cancha 1', activa: true },
            { id: 'c2', nombre: 'Cancha 2', activa: true },
        ]);
    }
}
(0, vitest_1.describe)('generateNext court invariants', () => {
    (0, vitest_1.it)('allows a slot ending exactly at the configured range limit', async () => {
        (0, generateNextHarness_1.mockDivision)({ duracionPartido: 60, horarioPartido: '13:00 - 15:00' });
        (0, generateNextHarness_1.mockTeams)(['t1', 't2']);
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [{ ...slot, horaInicio: '14:00', horaFin: '15:00' }]))
            .resolves.toBeDefined();
    });
    vitest_1.it.each([
        ['15:00', '16:00'],
        ['14:01', '15:01'],
    ])('rejects %s-%s outside the configured range', async (horaInicio, horaFin) => {
        (0, generateNextHarness_1.mockDivision)({ duracionPartido: 60, horarioPartido: '13:00 - 15:00' });
        (0, generateNextHarness_1.mockTeams)(['t1', 't2']);
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [{ ...slot, horaInicio, horaFin }]))
            .rejects.toThrow('fuera del rango configurado');
    });
    (0, vitest_1.it)('requires horaFin to match the authoritative division duration', async () => {
        arrange();
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [{ ...slot, horaFin: '19:30' }]))
            .rejects.toThrow('no coincide con la duración de 60 minutos');
    });
    (0, vitest_1.it)('refuses scheduled slots when the division has no authoritative duration', async () => {
        (0, generateNextHarness_1.mockDivision)({ duracionPartido: null });
        (0, generateNextHarness_1.mockTeams)(['t1', 't2']);
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [slot]))
            .rejects.toThrow('duración de partido válida');
    });
    (0, vitest_1.it)('forces the virtual court in SINGLE mode', async () => {
        arrange();
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [{ ...slot, canchaId: 'c1' }]))
            .rejects.toThrow('canchaId nulo');
    });
    (0, vitest_1.it)('requires an explicit active same-league court in MULTIPLE mode', async () => {
        arrange(true);
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [slot]))
            .rejects.toThrow('cancha activa de esta liga');
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [{ ...slot, canchaId: 'otra-liga' }]))
            .rejects.toThrow('cancha activa de esta liga');
    });
    (0, vitest_1.it)('resuelve y persiste la cancha fija aunque el cliente la omita', async () => {
        arrange(true);
        (0, generateNextHarness_1.mockDivision)({ duracionPartido: 60, multiplesCanchas: true, canchaUnicaId: 'c1' });
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [slot]);
        (0, vitest_1.expect)(generateNextHarness_1.partidoRepository.create).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ canchaId: 'c1' }));
    });
    (0, vitest_1.it)('repite una generación con la misma clave sin crear ni notificar otra jornada', async () => {
        arrange(true);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [{ ...slot, canchaId: 'c1' }], 'same-generation-key');
        const createData = generateNextHarness_1.jornadaRepository.create.mock.calls[0][0];
        (0, vitest_1.expect)(createData).toEqual(vitest_1.expect.objectContaining({
            generationKey: 'same-generation-key',
            generationRequestHash: vitest_1.expect.stringMatching(/^[a-f0-9]{64}$/),
        }));
        generateNextHarness_1.prisma.$transaction.mockClear();
        generateNextHarness_1.prisma.notificationOutbox.createMany.mockClear();
        generateNextHarness_1.prisma.jornada.findFirst.mockResolvedValue({
            ...createData,
            id: 'j-new-1',
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const replay = await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [{ ...slot, canchaId: 'c1' }], 'same-generation-key');
        (0, vitest_1.expect)(replay).toMatchObject({ id: 'j-new-1', idempotencyReplayed: true });
        (0, vitest_1.expect)(generateNextHarness_1.prisma.$transaction).not.toHaveBeenCalled();
        (0, vitest_1.expect)(generateNextHarness_1.prisma.notificationOutbox.createMany).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('rechaza reutilizar una clave con una programación diferente', async () => {
        arrange(true);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [{ ...slot, canchaId: 'c1' }], 'reused-generation-key');
        const createData = generateNextHarness_1.jornadaRepository.create.mock.calls[0][0];
        generateNextHarness_1.prisma.jornada.findFirst.mockResolvedValue({
            ...createData,
            id: 'j-new-1',
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [{ ...slot, horaInicio: '19:00', horaFin: '20:00', canchaId: 'c1' }], 'reused-generation-key'))
            .rejects.toThrow('clave de idempotencia ya fue usada');
    });
    (0, vitest_1.it)('rechaza una cancha distinta a la fija y una cancha fija inactiva', async () => {
        arrange(true);
        (0, generateNextHarness_1.mockDivision)({ duracionPartido: 60, multiplesCanchas: true, canchaUnicaId: 'c1' });
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [{ ...slot, canchaId: 'c2' }]))
            .rejects.toThrow('cancha fija de la división');
        arrange(true);
        (0, generateNextHarness_1.mockDivision)({ duracionPartido: 60, multiplesCanchas: true, canchaUnicaId: 'inactive' });
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [slot]))
            .rejects.toThrow('cancha fija de la división no está activa');
    });
    (0, vitest_1.it)('rejects MULTIPLE mode with fewer than two active named courts', async () => {
        arrange(true);
        generateNextHarness_1.prisma.ligaCancha.findMany.mockResolvedValue([
            { id: 'c1', nombre: 'Cancha 1', activa: true },
        ]);
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [{ ...slot, canchaId: 'c1' }]))
            .rejects.toThrow('al menos 2 canchas activas');
    });
    (0, vitest_1.it)('uses persisted division duration for league-wide occupancy', async () => {
        arrange(true);
        generateNextHarness_1.prisma.partido.findMany.mockResolvedValue([{
                id: 'other-division-match',
                canchaId: 'c1',
                fecha: new Date(2099, 0, 1, 17, 30),
                jornada: { division: { duracionPartido: 120 } },
                rondaPlayoff: null,
            }]);
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [{ ...slot, canchaId: 'c1' }]))
            .rejects.toThrow('ya tiene otro partido programado');
    });
    (0, vitest_1.it)('allows an old non-overlapping match with no assigned court', async () => {
        arrange(true);
        generateNextHarness_1.prisma.partido.findMany.mockResolvedValue([{
                id: 'old-unassigned',
                canchaId: null,
                fecha: new Date(2098, 0, 1, 18, 0),
                jornada: { division: { duracionPartido: 60 } },
                rondaPlayoff: null,
            }]);
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [{ ...slot, canchaId: 'c1' }])).resolves.toBeDefined();
    });
    (0, vitest_1.it)('blocks overlapping occupancy whose court is unresolved', async () => {
        arrange(true);
        generateNextHarness_1.prisma.partido.findMany.mockResolvedValue([{
                id: 'overlapping-unassigned',
                canchaId: null,
                fecha: new Date(2099, 0, 1, 18, 30),
                jornada: { division: { duracionPartido: 60 } },
                rondaPlayoff: null,
            }]);
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [{ ...slot, canchaId: 'c1' }]))
            .rejects.toThrow('se solapa con el horario solicitado y no tiene una cancha activa válida');
    });
    (0, vitest_1.it)('allows non-overlapping history assigned to an inactive court', async () => {
        arrange(true);
        generateNextHarness_1.prisma.partido.findMany.mockResolvedValue([{
                id: 'old-inactive-court',
                canchaId: 'inactive-court',
                fecha: new Date(2098, 5, 1, 18, 0),
                jornada: { division: { duracionPartido: 90 } },
                rondaPlayoff: null,
            }]);
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [{ ...slot, canchaId: 'c1' }])).resolves.toBeDefined();
        (0, vitest_1.expect)(generateNextHarness_1.prisma.partido.findMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: vitest_1.expect.objectContaining({ fecha: vitest_1.expect.objectContaining({ lt: new Date(2099, 0, 1, 19, 0) }) }),
        }));
    });
    (0, vitest_1.it)('commits with Serializable isolation and preserves the validated court', async () => {
        arrange(true);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [{ ...slot, canchaId: 'c1' }]);
        (0, vitest_1.expect)(generateNextHarness_1.prisma.$transaction).toHaveBeenCalledWith(vitest_1.expect.any(Function), { isolationLevel: 'Serializable' });
        (0, vitest_1.expect)(generateNextHarness_1.partidoRepository.create).toHaveBeenCalledWith(vitest_1.expect.objectContaining({ canchaId: 'c1' }));
    });
    (0, vitest_1.it)('maps nested PostgreSQL exclusion errors without masking unrelated P2004 errors', async () => {
        arrange(true);
        generateNextHarness_1.prisma.$transaction.mockRejectedValueOnce(Object.assign(new Error('constraint failed'), {
            code: 'P2004',
            meta: { database_error: { code: '23P01', constraint: 'partidos_cancha_no_overlap' } },
        }));
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [{ ...slot, canchaId: 'c1' }]))
            .rejects.toThrow('La cancha ya fue ocupada por otro partido');
        arrange(true);
        const unrelated = Object.assign(new Error('other check failed'), { code: 'P2004' });
        generateNextHarness_1.prisma.$transaction.mockRejectedValueOnce(unrelated);
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [{ ...slot, canchaId: 'c1' }])).rejects.toBe(unrelated);
    });
});
//# sourceMappingURL=generateNext.court-invariants.test.js.map