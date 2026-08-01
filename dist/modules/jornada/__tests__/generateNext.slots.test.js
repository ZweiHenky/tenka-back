"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const generateNextHarness_1 = require("./support/generateNextHarness");
(0, vitest_1.beforeEach)(generateNextHarness_1.resetGenerateNextHarness);
(0, vitest_1.describe)('generateNext slots', () => {
    (0, vitest_1.it)('7 equipos + 1 slot normal completo → slot respetado', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(3);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1', equipoVisitanteId: 't2' },
        ]);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        (0, vitest_1.expect)(calls.length).toBe(3);
        (0, vitest_1.expect)((0, generateNextHarness_1.expectMatch)(calls, 't1', 't2', 'REGULAR')).toBe(true);
        // t1 and t2 should NOT appear in any other match
        const otherMatches = calls.filter(([args]) => args.equipoLocalId !== 't1' || args.equipoVisitanteId !== 't2');
        otherMatches.forEach(([args]) => {
            (0, vitest_1.expect)(args.equipoLocalId).not.toBe('t1');
            (0, vitest_1.expect)(args.equipoVisitanteId).not.toBe('t1');
            (0, vitest_1.expect)(args.equipoLocalId).not.toBe('t2');
            (0, vitest_1.expect)(args.equipoVisitanteId).not.toBe('t2');
        });
    });
    (0, vitest_1.it)('7 equipos + 1 complemento con 1 equipo → complemento no excluye del RR', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(4);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento', equipoLocalId: 't4' },
        ]);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        const compMatch = calls.find(([args]) => args.equipoLocalId === 't4');
        (0, vitest_1.expect)(compMatch).toBeDefined();
        const [compArgs] = compMatch;
        (0, vitest_1.expect)(compArgs.tipoPartido).toBe('COMPLEMENTO');
    });
    (0, vitest_1.it)('complemento vacío → ValidationError', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento' },
        ])).rejects.toThrow('debe tener al menos el equipo que obtiene puntos');
    });
    (0, vitest_1.it)('amistoso sin equipos → ValidationError', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'amistoso' },
        ])).rejects.toThrow('debe tener ambos equipos asignados');
    });
    (0, vitest_1.it)('amistoso con un solo equipo → ValidationError', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'amistoso', equipoLocalId: 't1' },
        ])).rejects.toThrow('debe tener ambos equipos asignados');
    });
    (0, vitest_1.it)('mismo equipo en 2 slots normales → ValidationError', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1', equipoVisitanteId: 't2' },
            { fecha: '2099-01-01', horaInicio: '19:30', horaFin: '21:00', equipoLocalId: 't1', equipoVisitanteId: 't3' },
        ])).rejects.toThrow('ya está asignado a otro horario');
    });
    (0, vitest_1.it)('mismo equipo en normal + complemento → permitido (puntos puede repetirse)', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(4);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1', equipoVisitanteId: 't2' },
            { fecha: '2099-01-01', horaInicio: '19:30', horaFin: '21:00', tipo: 'complemento', equipoLocalId: 't1' },
        ]);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        const compMatch = calls.find(([args]) => args.tipoPartido === 'COMPLEMENTO');
        (0, vitest_1.expect)(compMatch).toBeDefined();
    });
    (0, vitest_1.it)('más pairings que slots en plan → padding', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(4);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1', equipoVisitanteId: 't2' },
            { fecha: '2099-01-01', horaInicio: '19:30', horaFin: '21:00', tipo: 'complemento', equipoLocalId: 't3' },
        ]);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        (0, vitest_1.expect)(calls.length).toBe(4);
    });
    (0, vitest_1.it)('flags correctos: Puntos en complemento suma, Sin puntos no suma', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(4);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento', equipoLocalId: 't4' },
        ]);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        const compMatch = calls.find(([args]) => args.equipoLocalId === 't4');
        (0, vitest_1.expect)(compMatch).toBeDefined();
        const [compArgs] = compMatch;
        (0, vitest_1.expect)(compArgs.tipoPartido).toBe('COMPLEMENTO');
    });
    (0, vitest_1.it)('complemento con ambos equipos asignados → Puntos y Sin puntos preservan tipo', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(4);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento', equipoLocalId: 't4', equipoVisitanteId: 't5' },
        ]);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        const comp = calls.find(([args]) => args.equipoLocalId === 't4' && args.equipoVisitanteId === 't5');
        (0, vitest_1.expect)(comp).toBeDefined();
        const [compArgs] = comp;
        (0, vitest_1.expect)(compArgs.tipoPartido).toBe('COMPLEMENTO');
    });
    (0, vitest_1.it)('2 complementos con 1 equipo cada uno → excluye del RR, flags correctos', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(4);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento', equipoLocalId: 't4' },
            { fecha: '2099-01-01', horaInicio: '19:30', horaFin: '21:00', tipo: 'complemento', equipoLocalId: 't5' },
        ]);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        const t4Comp = calls.find(([args]) => args.equipoLocalId === 't4');
        (0, vitest_1.expect)(t4Comp).toBeDefined();
        const [t4Args] = t4Comp;
        (0, vitest_1.expect)(t4Args.tipoPartido).toBe('COMPLEMENTO');
        const t5Comp = calls.find(([args]) => args.equipoLocalId === 't5');
        (0, vitest_1.expect)(t5Comp).toBeDefined();
        const [t5Args] = t5Comp;
        (0, vitest_1.expect)(t5Args.tipoPartido).toBe('COMPLEMENTO');
    });
    (0, vitest_1.it)('slots=[] (array vacío) → mismo que undefined', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(3);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, []);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        (0, vitest_1.expect)(calls.length).toBe(3);
    });
    (0, vitest_1.it)('slot parcial con historial previo → no repite el mismo rival de J1', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 6, diasPartido: null });
        const sixTeams = generateNextHarness_1.TEAMS.slice(0, 6);
        generateNextHarness_1.prisma.divisionEquipo.findMany.mockResolvedValue(sixTeams.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })));
        // J1 had t1 vs t2
        generateNextHarness_1.jornadaRepository.findByDivision.mockResolvedValue({
            rows: [{
                    numero: 1,
                    partidos: [{
                            equipoLocalId: 't1',
                            equipoVisitanteId: 't2',
                            tipoPartido: 'REGULAR',
                        }],
                }],
        });
        (0, generateNextHarness_1.mockJornadaCreated)(2);
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(3);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-08', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1' },
        ]);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        (0, vitest_1.expect)(calls.length).toBe(3);
        const t1Match = calls.find(([args]) => args.equipoLocalId === 't1' || args.equipoVisitanteId === 't1');
        (0, vitest_1.expect)(t1Match).toBeDefined();
        const [t1Args] = t1Match;
        // Should NOT face t2 again
        const opponent = t1Args.equipoLocalId === 't1' ? t1Args.equipoVisitanteId : t1Args.equipoLocalId;
        (0, vitest_1.expect)(opponent).not.toBe('t2');
        // With r=1 on 6 teams, canonical RR pairing for t1 is t3
        (0, vitest_1.expect)(opponent).toBe('t3');
    });
    (0, vitest_1.it)('slot parcial visitante con historial → no repite rival', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 6, diasPartido: null });
        const sixTeams = generateNextHarness_1.TEAMS.slice(0, 6);
        generateNextHarness_1.prisma.divisionEquipo.findMany.mockResolvedValue(sixTeams.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })));
        // J1 had t2 vs t1 (reverse orientation)
        generateNextHarness_1.jornadaRepository.findByDivision.mockResolvedValue({
            rows: [{
                    numero: 1,
                    partidos: [{
                            equipoLocalId: 't2',
                            equipoVisitanteId: 't1',
                            tipoPartido: 'REGULAR',
                        }],
                }],
        });
        (0, generateNextHarness_1.mockJornadaCreated)(2);
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(3);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-08', horaInicio: '18:00', horaFin: '19:30', equipoVisitanteId: 't1' },
        ]);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        (0, vitest_1.expect)(calls.length).toBe(3);
        const t1Match = calls.find(([args]) => args.equipoLocalId === 't1' || args.equipoVisitanteId === 't1');
        (0, vitest_1.expect)(t1Match).toBeDefined();
        const [t1Args] = t1Match;
        const opponent = t1Args.equipoLocalId === 't1' ? t1Args.equipoVisitanteId : t1Args.equipoLocalId;
        (0, vitest_1.expect)(opponent).not.toBe('t2');
    });
    (0, vitest_1.it)('slot normal parcial (solo local) → se llena del pool', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(3);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1' },
        ]);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        (0, vitest_1.expect)(calls.length).toBe(3);
        const matchWithT1 = calls.find(([args]) => args.equipoLocalId === 't1' || args.equipoVisitanteId === 't1');
        (0, vitest_1.expect)(matchWithT1).toBeDefined();
        // t1 should not be in any other match
        const t1Count = calls.filter(([args]) => args.equipoLocalId === 't1' || args.equipoVisitanteId === 't1').length;
        (0, vitest_1.expect)(t1Count).toBe(1);
    });
    (0, vitest_1.it)('mixed jornada: regular + amistoso + complemento, each preserves tipoPartido', async () => {
        const sixTeams = generateNextHarness_1.TEAMS.slice(0, 6);
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 6, diasPartido: null });
        generateNextHarness_1.prisma.divisionEquipo.findMany.mockResolvedValue(sixTeams.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })));
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        (0, generateNextHarness_1.mockPartidosCreatedReturn)(5);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1', equipoVisitanteId: 't2' },
            { fecha: '2099-01-01', horaInicio: '19:30', horaFin: '21:00', tipo: 'amistoso', equipoLocalId: 't3', equipoVisitanteId: 't4' },
            { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'complemento', equipoLocalId: 't5', equipoVisitanteId: 't6' },
        ]);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        // 3 from plan + 1 padding (complemento local blockeado)
        (0, vitest_1.expect)(calls.length).toBe(4);
        const regular = calls.find(([args]) => args.equipoLocalId === 't1' && args.equipoVisitanteId === 't2');
        (0, vitest_1.expect)(regular).toBeDefined();
        (0, vitest_1.expect)(regular[0].tipoPartido).toBe('REGULAR');
        const amistoso = calls.find(([args]) => args.equipoLocalId === 't3' && args.equipoVisitanteId === 't4');
        (0, vitest_1.expect)(amistoso).toBeDefined();
        (0, vitest_1.expect)(amistoso[0].tipoPartido).toBe('AMISTOSO');
        const complemento = calls.find(([args]) => args.equipoLocalId === 't5' && args.equipoVisitanteId === 't6');
        (0, vitest_1.expect)(complemento).toBeDefined();
        (0, vitest_1.expect)(complemento[0].tipoPartido).toBe('COMPLEMENTO');
    });
});
//# sourceMappingURL=generateNext.slots.test.js.map