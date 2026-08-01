"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const generateNextHarness_1 = require("./support/generateNextHarness");
(0, vitest_1.beforeEach)(generateNextHarness_1.resetGenerateNextHarness);
(0, vitest_1.describe)('generateNext regular pairings', () => {
    (0, vitest_1.it)('lanza ValidationError si hay menos de 2 equipos', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)(['t1']);
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId)).rejects.toThrow('Se necesitan al menos 2 equipos');
    });
    (0, vitest_1.it)('8 equipos sin slots → 4 partidos round-robin', async () => {
        const eightTeams = [
            ...generateNextHarness_1.TEAMS,
            { id: 't8', nombre: 'Rayos' },
        ];
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 8, diasPartido: null });
        generateNextHarness_1.prisma.divisionEquipo.findMany.mockResolvedValue(eightTeams.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })));
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(4);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        (0, vitest_1.expect)(calls.length).toBe(4);
        const allTeams = new Set(calls.map(([args]) => args.equipoLocalId).concat(calls.map(([args]) => args.equipoVisitanteId)));
        eightTeams.forEach((t) => (0, vitest_1.expect)(allTeams.has(t.id)).toBe(true));
    });
    (0, vitest_1.it)('7 equipos sin slots → 3 partidos (1 descansa)', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(3);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        (0, vitest_1.expect)(calls.length).toBe(3);
        const usedTeams = new Set(calls.map(([args]) => args.equipoLocalId).concat(calls.map(([args]) => args.equipoVisitanteId)));
        (0, vitest_1.expect)(usedTeams.size).toBe(6);
        (0, vitest_1.expect)(usedTeams.has('DESCANSO')).toBe(false);
    });
    (0, vitest_1.it)('rotación con jornadas previas (r=4) → pairings diferentes a J1', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)();
        generateNextHarness_1.jornadaRepository.findByDivision.mockResolvedValue({
            rows: [1, 2, 3, 4].map((numero) => ({
                numero,
                partidos: [{ equipoLocalId: 'history-a', equipoVisitanteId: 'history-b', tipoPartido: 'REGULAR' }],
            })),
        });
        (0, generateNextHarness_1.mockJornadaCreated)(5);
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(3);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        (0, vitest_1.expect)(calls.length).toBe(3);
        // r=4 → t1 vs t6 (no t1 vs t2 como en J1)
        const hasT1vsT2 = calls.some(([args]) => args.equipoLocalId === 't1' && args.equipoVisitanteId === 't2');
        (0, vitest_1.expect)(hasT1vsT2).toBe(false);
        // Verificar que rotó: algún pairing esperado con r=4
        const hasT1vsT6 = calls.some(([args]) => (args.equipoLocalId === 't1' && args.equipoVisitanteId === 't6') || (args.equipoLocalId === 't6' && args.equipoVisitanteId === 't1'));
        (0, vitest_1.expect)(hasT1vsT6).toBe(true);
    });
    (0, vitest_1.it)('5 equipos sin slots → 2 partidos + 1 descanso', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 5, diasPartido: null });
        generateNextHarness_1.prisma.divisionEquipo.findMany.mockResolvedValue(generateNextHarness_1.TEAMS.slice(0, 5).map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })));
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(2);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        (0, vitest_1.expect)(calls.length).toBe(2);
        const usedTeams = new Set(calls.map(([args]) => args.equipoLocalId).concat(calls.map(([args]) => args.equipoVisitanteId)));
        (0, vitest_1.expect)(usedTeams.size).toBe(4);
        (0, vitest_1.expect)(usedTeams.has('DESCANSO')).toBe(false);
    });
    (0, vitest_1.it)('amistoso previo no bloquea cruce regular', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)();
        generateNextHarness_1.jornadaRepository.findByDivision.mockResolvedValue({
            rows: [{
                    numero: 1,
                    partidos: [{
                            equipoLocalId: 't1',
                            equipoVisitanteId: 't2',
                            tipoPartido: 'AMISTOSO',
                        }],
                }],
        });
        (0, generateNextHarness_1.mockJornadaCreated)(2);
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(3);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-08', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1' },
        ]);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        const t1Match = calls.find(([args]) => args.equipoLocalId === 't1' || args.equipoVisitanteId === 't1');
        (0, vitest_1.expect)(t1Match).toBeDefined();
        const [t1Args] = t1Match;
        const opponent = t1Args.equipoLocalId === 't1' ? t1Args.equipoVisitanteId : t1Args.equipoLocalId;
        // The friendly jornada must not advance the regular rotation: r=0 still pairs t1 vs t2.
        (0, vitest_1.expect)(opponent).toBe('t2');
    });
    (0, vitest_1.it)('ciclo completo 6 equipos sin slots → 15 pairings únicos en 5 jornadas', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 6, diasPartido: null });
        const sixTeams = generateNextHarness_1.TEAMS.slice(0, 6);
        generateNextHarness_1.prisma.divisionEquipo.findMany.mockResolvedValue(sixTeams.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })));
        const seen = new Set();
        for (let j = 1; j <= 5; j++) {
            if (j > 1) {
                const prev = [];
                for (let p = 1; p < j; p++) {
                    prev.push({
                        numero: p,
                        partidos: [{ equipoLocalId: 'history-a', equipoVisitanteId: 'history-b', tipoPartido: 'REGULAR' }],
                    });
                }
                generateNextHarness_1.jornadaRepository.findByDivision.mockResolvedValue({ rows: prev });
            }
            else {
                (0, generateNextHarness_1.mockNoPreviousJornadas)();
            }
            (0, generateNextHarness_1.mockJornadaCreated)(j);
            (0, generateNextHarness_1.mockPartidosCreatedReturn)(3);
            await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId);
            const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
            const lastBatch = calls.slice(-3);
            for (const [args] of lastBatch) {
                const key = [args.equipoLocalId, args.equipoVisitanteId].sort().join('-');
                if (args.equipoLocalId !== 'DESCANSO' && args.equipoVisitanteId !== 'DESCANSO') {
                    seen.add(key);
                }
            }
        }
        // 6 teams → 15 unique unordered regular pairs
        (0, vitest_1.expect)(seen.size).toBe(15);
    });
});
//# sourceMappingURL=generateNext.regular-pairings.test.js.map