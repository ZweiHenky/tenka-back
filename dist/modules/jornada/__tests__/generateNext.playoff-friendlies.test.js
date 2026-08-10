"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const generateNextHarness_1 = require("./support/generateNextHarness");
(0, vitest_1.beforeEach)(generateNextHarness_1.resetGenerateNextHarness);
(0, vitest_1.describe)('generateNext playoff mode — amistosos auto-fill', () => {
    const TEN_TEAMS = [
        { id: 't1', nombre: 'Águilas' },
        { id: 't2', nombre: 'Dragones' },
        { id: 't3', nombre: 'Genix' },
        { id: 't4', nombre: 'Mi Equipo' },
        { id: 't5', nombre: 'Leones' },
        { id: 't6', nombre: 'Tiburones' },
        { id: 't7', nombre: 'Panteras' },
        { id: 't8', nombre: 'Rayos' },
        { id: 't9', nombre: 'Fénix' },
        { id: 't10', nombre: 'Lobos' },
    ];
    const ELIM_SLOTS = [
        { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'eliminatoria', partidoId: 'p1', equipoLocalId: 't1', equipoVisitanteId: 't2' },
        { fecha: '2099-01-01', horaInicio: '19:30', horaFin: '21:00', tipo: 'eliminatoria', partidoId: 'p2', equipoLocalId: 't3', equipoVisitanteId: 't4' },
    ];
    function mockPlayoffMode() {
        generateNextHarness_1.prisma.rondaPlayoff.findMany.mockResolvedValue([{ id: 'r1' }]);
    }
    function mockTenTeams() {
        generateNextHarness_1.prisma.divisionEquipo.findMany.mockResolvedValue(TEN_TEAMS.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })));
    }
    function mockEliminatoriaPartidos() {
        generateNextHarness_1.partidoRepository.findById.mockImplementation((id) => {
            const slot = ELIM_SLOTS.find((s) => s.partidoId === id);
            if (!slot)
                return null;
            return { id, equipoLocalId: slot.equipoLocalId, equipoVisitanteId: slot.equipoVisitanteId, jornadaId: null };
        });
    }
    (0, vitest_1.it)('rejects a slot without an explicit friendly or playoff type', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 10, diasPartido: null });
        mockPlayoffMode();
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30' },
        ])).rejects.toThrow('Solo se permiten partidos amistosos o de eliminatoria');
    });
    (0, vitest_1.it)('incluye eliminatorias en conflictos de la misma cancha y excluye el propio partido de la consulta', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 10, diasPartido: null, multiplesCanchas: true });
        mockPlayoffMode();
        mockTenTeams();
        mockEliminatoriaPartidos();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        generateNextHarness_1.prisma.ligaCancha.findMany.mockResolvedValue([
            { id: 'c1', nombre: 'Cancha 1' },
            { id: 'c2', nombre: 'Cancha 2' },
        ]);
        generateNextHarness_1.prisma.partido.findMany
            .mockResolvedValueOnce([{ id: 'p1', equipoLocalId: 't1', equipoVisitanteId: 't2', jornadaId: null }])
            .mockResolvedValueOnce([]);
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { ...ELIM_SLOTS[0], canchaId: 'c1' },
            { fecha: '2099-01-01', horaInicio: '18:30', horaFin: '20:00', tipo: 'amistoso', equipoLocalId: 't3', equipoVisitanteId: 't4', canchaId: 'c1' },
        ])).rejects.toThrow('ya tiene otro partido programado');
        (0, vitest_1.expect)(generateNextHarness_1.prisma.partido.findMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: vitest_1.expect.objectContaining({ id: { notIn: ['p1'] } }),
        }));
        (0, vitest_1.expect)(generateNextHarness_1.partidoRepository.update).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('3 amistosos vacíos con 10 equipos y 4 en eliminatoria → usa 6 equipos libres', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 10, diasPartido: null });
        mockPlayoffMode();
        mockTenTeams();
        mockEliminatoriaPartidos();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            ...ELIM_SLOTS,
            { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso' },
            { fecha: '2099-01-01', horaInicio: '22:30', horaFin: '00:00', tipo: 'amistoso' },
            { fecha: '2099-01-01', horaInicio: '00:00', horaFin: '01:30', tipo: 'amistoso' },
        ]);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        // 3 amistosos (eliminatorias usan update, no create)
        (0, vitest_1.expect)(calls.length).toBe(3);
        // Count unique teams in amistosos (should be 6 non-eliminatoria teams)
        const amistosos = calls.filter(([args]) => args.tipoPartido === 'AMISTOSO');
        (0, vitest_1.expect)(amistosos.length).toBe(3);
        const amistosoTeamIds = new Set();
        for (const [args] of amistosos) {
            amistosoTeamIds.add(args.equipoLocalId);
            amistosoTeamIds.add(args.equipoVisitanteId);
        }
        (0, vitest_1.expect)(amistosoTeamIds.size).toBe(6);
        // Verify no eliminatoria team is in an amistoso
        for (const id of amistosoTeamIds) {
            (0, vitest_1.expect)(['t1', 't2', 't3', 't4'].includes(id)).toBe(false);
        }
        // Verify all non-eliminatoria teams are accounted for
        const nonElimTeams = ['t5', 't6', 't7', 't8', 't9', 't10'];
        for (const id of nonElimTeams) {
            (0, vitest_1.expect)(amistosoTeamIds.has(id)).toBe(true);
        }
    });
    (0, vitest_1.it)('1 amistoso vacío, no bastan libres → usa equipos de eliminatoria', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 10, diasPartido: null });
        mockPlayoffMode();
        mockTenTeams();
        mockEliminatoriaPartidos();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        // Only non-eliminatoria teams: t5, t6, t7, t8, t9, t10
        // 3 amistosos need 6 teams, but we have only 6 free ones.
        // 4th amistoso would need eliminatoria teams
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            ...ELIM_SLOTS,
            { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso' },
            { fecha: '2099-01-01', horaInicio: '22:30', horaFin: '00:00', tipo: 'amistoso' },
            { fecha: '2099-01-01', horaInicio: '00:00', horaFin: '01:30', tipo: 'amistoso' },
            { fecha: '2099-01-01', horaInicio: '01:30', horaFin: '03:00', tipo: 'amistoso' },
        ]);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        // 4 amistosos (eliminatorias usan update, no create)
        (0, vitest_1.expect)(calls.length).toBe(4);
        const amistosos = calls.filter(([args]) => args.tipoPartido === 'AMISTOSO');
        (0, vitest_1.expect)(amistosos.length).toBe(4);
        const amistosoTeamIds = new Set();
        for (const [args] of amistosos) {
            amistosoTeamIds.add(args.equipoLocalId);
            amistosoTeamIds.add(args.equipoVisitanteId);
        }
        // 4 amistosos × 2 = 8 team slots, but there are only 10 teams total - 4 eliminatoria = 6 + up to 4 from eliminatoria
        // 6 non-elim + 2 eliminatoria = 8 unique teams
        (0, vitest_1.expect)(amistosoTeamIds.size).toBe(8);
        // At least one eliminatoria team should be in amistosos
        const usedElim = [...amistosoTeamIds].filter((id) => ['t1', 't2', 't3', 't4'].includes(id));
        (0, vitest_1.expect)(usedElim.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('amistoso manual no puede duplicar cruce de eliminatoria', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 10, diasPartido: null });
        mockPlayoffMode();
        mockTenTeams();
        mockEliminatoriaPartidos();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            ...ELIM_SLOTS,
            { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2' },
        ])).rejects.toThrow('repite el mismo cruce que un partido de eliminatoria');
    });
    (0, vitest_1.it)('amistoso parcial evita duplicado de cruce eliminatoria', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 10, diasPartido: null });
        mockPlayoffMode();
        mockTenTeams();
        mockEliminatoriaPartidos();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        // Amistoso parcial: t1 assigned, need opponent. t2 is the eliminatoria opponent → should NOT pick t2
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            ...ELIM_SLOTS,
            { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't1' },
        ]);
        const calls = generateNextHarness_1.partidoRepository.create.mock.calls;
        const amistoso = calls.find(([args]) => args.tipoPartido === 'AMISTOSO');
        (0, vitest_1.expect)(amistoso).toBeDefined();
        // Should NOT pair t1 with t2 (eliminatoria duplicate)
        (0, vitest_1.expect)(amistoso[0].equipoLocalId === 't1' && amistoso[0].equipoVisitanteId === 't2').toBe(false);
        (0, vitest_1.expect)(amistoso[0].equipoVisitanteId === 't1' && amistoso[0].equipoLocalId === 't2').toBe(false);
    });
    (0, vitest_1.it)('no hay suficientes equipos para amistosos → ValidationError', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 10, diasPartido: null });
        mockPlayoffMode();
        // Only 2 teams total, 1 eliminatoria (t1 vs t2), 1 empty amistoso
        // The only possible pairing t1 vs t2 would duplicate the eliminatoria match
        generateNextHarness_1.prisma.divisionEquipo.findMany.mockResolvedValue(TEN_TEAMS.slice(0, 2).map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })));
        generateNextHarness_1.partidoRepository.findById.mockImplementation((id) => {
            const slot = ELIM_SLOTS.find((s) => s.partidoId === id);
            if (!slot)
                return null;
            // Only return the first eliminatoria slot
            if (id === 'p2')
                return null;
            return { id, equipoLocalId: slot.equipoLocalId, equipoVisitanteId: slot.equipoVisitanteId, jornadaId: null };
        });
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'eliminatoria', partidoId: 'p1', equipoLocalId: 't1', equipoVisitanteId: 't2' },
            { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso' },
        ])).rejects.toThrow('No hay combinaciones disponibles');
    });
    (0, vitest_1.it)('sin playoff mode, amistoso vacío sigue fallando', async () => {
        (0, generateNextHarness_1.mockDivision)();
        (0, generateNextHarness_1.mockTeams)();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'amistoso' },
        ])).rejects.toThrow('debe tener ambos equipos asignados');
    });
    (0, vitest_1.it)('un equipo puede jugar dos amistosos si las parejas son distintas', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 10, diasPartido: null });
        mockPlayoffMode();
        mockTenTeams();
        mockEliminatoriaPartidos();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            ...ELIM_SLOTS,
            { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't5', equipoVisitanteId: 't6' },
            { fecha: '2099-01-01', horaInicio: '22:30', horaFin: '00:00', tipo: 'amistoso', equipoLocalId: 't7', equipoVisitanteId: 't8' },
            { fecha: '2099-01-01', horaInicio: '00:00', horaFin: '01:30', tipo: 'amistoso', equipoLocalId: 't5' },
        ]);
        const amistosos = generateNextHarness_1.partidoRepository.create.mock.calls
            .filter(([args]) => args.tipoPartido === 'AMISTOSO');
        (0, vitest_1.expect)(amistosos).toHaveLength(3);
        const t5Matches = amistosos.filter(([args]) => args.equipoLocalId === 't5' || args.equipoVisitanteId === 't5');
        (0, vitest_1.expect)(t5Matches).toHaveLength(2);
        const pairKeys = amistosos.map(([args]) => [args.equipoLocalId, args.equipoVisitanteId].sort().join('-'));
        (0, vitest_1.expect)(new Set(pairKeys).size).toBe(pairKeys.length);
    });
    (0, vitest_1.it)('dos amistosos completos pueden repetir equipo con parejas distintas', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 10, diasPartido: null });
        mockPlayoffMode();
        mockTenTeams();
        mockEliminatoriaPartidos();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            ...ELIM_SLOTS,
            { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't5', equipoVisitanteId: 't6' },
            { fecha: '2099-01-01', horaInicio: '22:30', horaFin: '00:00', tipo: 'amistoso', equipoLocalId: 't5', equipoVisitanteId: 't7' },
        ]);
        const amistosos = generateNextHarness_1.partidoRepository.create.mock.calls
            .filter(([args]) => args.tipoPartido === 'AMISTOSO');
        (0, vitest_1.expect)(amistosos).toHaveLength(2);
    });
    (0, vitest_1.it)('dos amistosos no pueden repetir la misma pareja invertida', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 10, diasPartido: null });
        mockPlayoffMode();
        mockTenTeams();
        mockEliminatoriaPartidos();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            ...ELIM_SLOTS,
            { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't5', equipoVisitanteId: 't6' },
            { fecha: '2099-01-01', horaInicio: '22:30', horaFin: '00:00', tipo: 'amistoso', equipoLocalId: 't6', equipoVisitanteId: 't5' },
        ])).rejects.toThrow('misma pareja');
        (0, vitest_1.expect)(generateNextHarness_1.partidoRepository.update).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('amistoso manual no permite el mismo equipo en ambos lados', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 10, diasPartido: null });
        mockPlayoffMode();
        mockTenTeams();
        mockEliminatoriaPartidos();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            ...ELIM_SLOTS,
            { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't5', equipoVisitanteId: 't5' },
        ])).rejects.toThrow('contra sí mismo');
    });
    (0, vitest_1.it)('amistoso manual rechaza equipos no habilitados', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 10, diasPartido: null });
        mockPlayoffMode();
        mockTenTeams();
        mockEliminatoriaPartidos();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            ...ELIM_SLOTS,
            { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't5', equipoVisitanteId: 'no-habilitado' },
        ])).rejects.toThrow('no está habilitado');
    });
    (0, vitest_1.it)('usa el cruce autoritativo de eliminatoria aunque el slot esté desactualizado', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 10, diasPartido: null });
        mockPlayoffMode();
        mockTenTeams();
        mockEliminatoriaPartidos();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { ...ELIM_SLOTS[0], equipoVisitanteId: 't3' },
            { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2' },
        ])).rejects.toThrow('repite el mismo cruce');
    });
    (0, vitest_1.it)('amistosos automáticos no repiten una pareja de la jornada anterior', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 4, diasPartido: null, duracionPartido: 60 });
        mockPlayoffMode();
        (0, generateNextHarness_1.mockTeams)(['t1', 't2', 't3', 't4']);
        generateNextHarness_1.jornadaRepository.findByDivision.mockResolvedValue({
            rows: [{
                    numero: 1,
                    partidos: [{ equipoLocalId: 't1', equipoVisitanteId: 't2', tipoPartido: 'AMISTOSO' }],
                }],
        });
        (0, generateNextHarness_1.mockJornadaCreated)(2);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-08', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso' },
        ]);
        const amistoso = generateNextHarness_1.partidoRepository.create.mock.calls
            .find(([args]) => args.tipoPartido === 'AMISTOSO');
        (0, vitest_1.expect)(amistoso).toBeDefined();
        (0, vitest_1.expect)([amistoso[0].equipoLocalId, amistoso[0].equipoVisitanteId].sort().join('-')).not.toBe('t1-t2');
    });
    (0, vitest_1.it)('rechaza un amistoso manual repetido mientras quedan parejas nuevas', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 4, diasPartido: null, duracionPartido: 60 });
        mockPlayoffMode();
        (0, generateNextHarness_1.mockTeams)(['t1', 't2', 't3', 't4']);
        generateNextHarness_1.jornadaRepository.findByDivision.mockResolvedValue({
            rows: [{
                    numero: 1,
                    partidos: [{ equipoLocalId: 't1', equipoVisitanteId: 't2', tipoPartido: 'AMISTOSO' }],
                }],
        });
        (0, generateNextHarness_1.mockJornadaCreated)(2);
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-01-08', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2' },
        ])).rejects.toThrow('todavía hay parejas disponibles');
    });
    (0, vitest_1.it)('inicia un nuevo ciclo amistoso después de agotar todas las parejas', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 4, diasPartido: null, duracionPartido: 60 });
        mockPlayoffMode();
        (0, generateNextHarness_1.mockTeams)(['t1', 't2', 't3', 't4']);
        const allPairs = [
            ['t1', 't2'], ['t1', 't3'], ['t1', 't4'],
            ['t2', 't3'], ['t2', 't4'], ['t3', 't4'],
        ];
        generateNextHarness_1.jornadaRepository.findByDivision.mockResolvedValue({
            rows: [{
                    numero: 6,
                    partidos: allPairs.map(([equipoLocalId, equipoVisitanteId]) => ({ equipoLocalId, equipoVisitanteId, tipoPartido: 'AMISTOSO' })),
                }],
        });
        (0, generateNextHarness_1.mockJornadaCreated)(7);
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            { fecha: '2099-02-01', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso' },
        ]);
        const amistosos = generateNextHarness_1.partidoRepository.create.mock.calls
            .filter(([args]) => args.tipoPartido === 'AMISTOSO');
        (0, vitest_1.expect)(amistosos).toHaveLength(1);
    });
    (0, vitest_1.it)('propaga un fallo transaccional sin compensaciones ni notificación', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 10, diasPartido: null });
        mockPlayoffMode();
        mockTenTeams();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        generateNextHarness_1.partidoRepository.findById.mockImplementation((id) => {
            const slot = ELIM_SLOTS.find((s) => s.partidoId === id);
            return {
                id,
                equipoLocalId: slot.equipoLocalId,
                equipoVisitanteId: slot.equipoVisitanteId,
                jornadaId: null,
                fecha: null,
                fechaFin: null,
                canchaId: null,
            };
        });
        generateNextHarness_1.prisma.$transaction.mockRejectedValueOnce(new Error('falló transaction'));
        await (0, vitest_1.expect)(generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, [
            ...ELIM_SLOTS,
            { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso' },
        ])).rejects.toThrow('falló transaction');
        (0, vitest_1.expect)(generateNextHarness_1.prisma.$transaction).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(generateNextHarness_1.prisma.partido.deleteMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(generateNextHarness_1.jornadaRepository.delete).not.toHaveBeenCalled();
        (0, vitest_1.expect)(generateNextHarness_1.prisma.notificationOutbox.createMany).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('recalcula si un partido de playoff deja de estar libre bajo el lock', async () => {
        (0, generateNextHarness_1.mockDivision)({ maxEquipos: 10, diasPartido: null });
        mockPlayoffMode();
        mockTenTeams();
        mockEliminatoriaPartidos();
        (0, generateNextHarness_1.mockNoPreviousJornadas)();
        (0, generateNextHarness_1.mockJornadaCreated)();
        generateNextHarness_1.prisma.partido.updateMany
            .mockResolvedValueOnce({ count: 0 })
            .mockResolvedValue({ count: 1 });
        await generateNextHarness_1.jornadaService.generateNext(generateNextHarness_1.divisionId, ELIM_SLOTS);
        (0, vitest_1.expect)(generateNextHarness_1.prisma.$transaction).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(generateNextHarness_1.prisma.partido.updateMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            where: { id: 'p1', jornadaId: null },
        }));
        (0, vitest_1.expect)(generateNextHarness_1.prisma.notificationOutbox.createMany).toHaveBeenCalledOnce();
    });
});
//# sourceMappingURL=generateNext.playoff-friendlies.test.js.map