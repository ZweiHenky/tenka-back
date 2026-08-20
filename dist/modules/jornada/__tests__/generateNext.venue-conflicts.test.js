"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const generateNextHarness_1 = require("./support/generateNextHarness");
(0, vitest_1.beforeEach)(generateNextHarness_1.resetGenerateNextHarness);
(0, vitest_1.describe)('generateNext conflictos de cancha', () => {
    function mockCanchas() {
        generateNextHarness_1.prisma.ligaCancha.findMany.mockResolvedValue([
            { id: 'c1', nombre: 'Cancha 1' },
            { id: 'c2', nombre: 'Cancha 2' },
        ]);
    }
    (0, vitest_1.it)('rechaza horarios solapados cuando no hay canchas configuradas', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 4, diasPartido: null, duracionPartido: 60 });
        (0, generateNextHarness_1.mockTeams)(['t1', 't2', 't3', 't4']);
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', equipoLocalId: 't1', equipoVisitanteId: 't2' },
            { fecha: '2099-01-01', horaInicio: '18:30', horaFin: '19:30', equipoLocalId: 't3', equipoVisitanteId: 't4' },
        ])).rejects.toThrow('ya tiene otro partido programado');
    });
    (0, vitest_1.it)('permite horarios consecutivos cuando no hay canchas configuradas', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 4, diasPartido: null, duracionPartido: 60 });
        (0, generateNextHarness_1.mockTeams)(['t1', 't2', 't3', 't4']);
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(2);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', equipoLocalId: 't1', equipoVisitanteId: 't2' },
            { fecha: '2099-01-01', horaInicio: '19:00', horaFin: '20:00', equipoLocalId: 't3', equipoVisitanteId: 't4' },
        ]);
        (0, vitest_1.expect)(generateNextHarness_1.partidoRepository.create).toHaveBeenCalled();
    });
    (0, vitest_1.it)('rechaza dos tipos de partido solapados en la misma cancha', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 4, diasPartido: null, duracionPartido: 60, multiplesCanchas: true });
        (0, generateNextHarness_1.mockTeams)(['t1', 't2', 't3', 't4']);
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        mockCanchas();
        generateNextHarness_1.prisma.partido.findMany.mockResolvedValue([]);
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' },
            { fecha: '2099-01-01', horaInicio: '18:30', horaFin: '19:30', equipoLocalId: 't3', equipoVisitanteId: 't4', canchaId: 'c1' },
        ])).rejects.toThrow('ya tiene otro partido programado');
    });
    (0, vitest_1.it)('permite partidos simultáneos en canchas diferentes', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 4, diasPartido: null, duracionPartido: 60, multiplesCanchas: true });
        (0, generateNextHarness_1.mockTeams)(['t1', 't2', 't3', 't4']);
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        mockCanchas();
        generateNextHarness_1.prisma.partido.findMany.mockResolvedValue([]);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' },
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', equipoLocalId: 't3', equipoVisitanteId: 't4', canchaId: 'c2' },
        ]);
        (0, vitest_1.expect)(generateNextHarness_1.partidoRepository.create).toHaveBeenCalled();
    });
    (0, vitest_1.it)('permite partidos consecutivos en la misma cancha', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 4, diasPartido: null, duracionPartido: 60, multiplesCanchas: true });
        (0, generateNextHarness_1.mockTeams)(['t1', 't2', 't3', 't4']);
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        mockCanchas();
        generateNextHarness_1.prisma.partido.findMany.mockResolvedValue([]);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' },
            { fecha: '2099-01-01', horaInicio: '19:00', horaFin: '20:00', equipoLocalId: 't3', equipoVisitanteId: 't4', canchaId: 'c1' },
        ]);
        (0, vitest_1.expect)(generateNextHarness_1.partidoRepository.create).toHaveBeenCalled();
    });
    (0, vitest_1.it)('rechaza conflicto con partido existente de otra división', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 4, diasPartido: null, duracionPartido: 60, multiplesCanchas: true });
        (0, generateNextHarness_1.mockTeams)(['t1', 't2']);
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        mockCanchas();
        generateNextHarness_1.prisma.partido.findMany.mockResolvedValueOnce([
            { id: 'partido-otra-division', canchaId: 'c1', fecha: new Date(2099, 0, 1, 18, 30), jornada: { division: { duracionPartido: 60 } }, rondaPlayoff: null },
        ]);
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' },
        ])).rejects.toThrow('ya tiene otro partido programado');
    });
    (0, vitest_1.describe)('alcance de la consulta de ocupación', () => {
        function setup(maxDuracionLiga) {
            (0, generateNextHarness_1.mockDivision)({ maxEquipos: 4, diasPartido: null, duracionPartido: 60, multiplesCanchas: true });
            (0, generateNextHarness_1.mockTeams)(['t1', 't2']);
            (0, generateNextHarness_1.mockNoPreviousJornadas)();
            (0, generateNextHarness_1.mockJornadaCreated)();
            (0, generateNextHarness_1.mockPartidosCreatedReturn)(1);
            mockCanchas();
            generateNextHarness_1.prisma.division.aggregate.mockResolvedValue({ _max: { duracionPartido: maxDuracionLiga } });
            generateNextHarness_1.prisma.partido.findMany.mockResolvedValue([]);
        }
        const draft = { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' };
        // The window spans [earliestDraftStart - margin, latestDraftEnd); with a single 60-minute
        // draft that is margin + 60 minutes. Asserting the span keeps this timezone-agnostic.
        function occupancyWindowMinutes() {
            const where = generateNextHarness_1.prisma.partido.findMany.mock.calls[0][0].where;
            (0, vitest_1.expect)(where.fecha.gte).toBeInstanceOf(Date);
            return (where.fecha.lt.getTime() - where.fecha.gte.getTime()) / 60000;
        }
        (0, vitest_1.it)('acota la consulta con un piso, en vez de leer todo el historial', async () => {
            setup(120);
            await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [draft]);
            // The 1440-minute guard wins over the league's 120-minute max.
            (0, vitest_1.expect)(occupancyWindowMinutes()).toBe(1440 + 60);
        });
        (0, vitest_1.it)('ensancha el piso cuando una división dura más que el margen por defecto', async () => {
            setup(3000);
            await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [draft]);
            (0, vitest_1.expect)(occupancyWindowMinutes()).toBe(3000 + 60);
        });
        (0, vitest_1.it)('usa el margen por defecto cuando la liga no tiene ninguna duración', async () => {
            setup(0);
            generateNextHarness_1.prisma.division.aggregate.mockResolvedValue({ _max: { duracionPartido: null } });
            await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [draft]);
            (0, vitest_1.expect)(occupancyWindowMinutes()).toBe(1440 + 60);
        });
    });
    (0, vitest_1.describe)('división sin duración configurada', () => {
        function setupBadDivision(canchaId) {
            (0, generateNextHarness_1.mockDivision)({ maxEquipos: 4, diasPartido: null, duracionPartido: 60, multiplesCanchas: true });
            (0, generateNextHarness_1.mockTeams)(['t1', 't2']);
            (0, generateNextHarness_1.mockNoPreviousJornadas)();
            (0, generateNextHarness_1.mockJornadaCreated)();
            (0, generateNextHarness_1.mockPartidosCreatedReturn)(1);
            mockCanchas();
            generateNextHarness_1.prisma.partido.findMany.mockResolvedValue([
                {
                    id: 'partido-sin-duracion',
                    canchaId,
                    fecha: new Date(2099, 0, 1, 18, 30),
                    jornada: { division: { id: 'div-mala', nombre: 'Femenil B', duracionPartido: null } },
                    rondaPlayoff: null,
                },
            ]);
        }
        const draft = { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' };
        (0, vitest_1.it)('no bloquea a otras divisiones cuando el partido inmensurable está en otra cancha', async () => {
            setupBadDivision('c2');
            await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [draft]);
            (0, vitest_1.expect)(generateNextHarness_1.partidoRepository.create).toHaveBeenCalled();
        });
        (0, vitest_1.it)('bloquea nombrando la división culpable cuando comparte la cancha', async () => {
            setupBadDivision('c1');
            await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [draft]))
                .rejects.toThrow(/Femenil B.*div-mala/);
        });
    });
});
//# sourceMappingURL=generateNext.venue-conflicts.test.js.map