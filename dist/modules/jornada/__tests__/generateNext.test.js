"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const service_1 = require("../service");
vitest_1.vi.mock('../../../config/database', () => ({
    prisma: {
        division: { findUnique: vitest_1.vi.fn() },
        divisionEquipo: { findMany: vitest_1.vi.fn() },
        partido: { findMany: vitest_1.vi.fn(), deleteMany: vitest_1.vi.fn(), createMany: vitest_1.vi.fn(), update: vitest_1.vi.fn() },
        jornada: { findUnique: vitest_1.vi.fn(), create: vitest_1.vi.fn() },
        rondaPlayoff: { findMany: vitest_1.vi.fn(), findFirst: vitest_1.vi.fn() },
        ligaCancha: { findMany: vitest_1.vi.fn() },
        $transaction: vitest_1.vi.fn(),
    },
}));
vitest_1.vi.mock('../repository', () => ({
    jornadaRepository: {
        findByDivision: vitest_1.vi.fn(),
        findGenerationHistory: vitest_1.vi.fn(),
        create: vitest_1.vi.fn(),
        update: vitest_1.vi.fn(),
        delete: vitest_1.vi.fn(),
    },
}));
vitest_1.vi.mock('../../partido/repository', () => ({
    partidoRepository: { create: vitest_1.vi.fn(), findById: vitest_1.vi.fn(), update: vitest_1.vi.fn() },
}));
vitest_1.vi.mock('../../tabla-posicion/service', () => ({
    tablaPosicionService: { recalcular: vitest_1.vi.fn() },
}));
vitest_1.vi.mock('../../notification/service', () => ({
    notificationService: { notifyJornadaGenerated: vitest_1.vi.fn() },
}));
vitest_1.vi.mock('../../../config/logger', () => ({
    logger: { info: vitest_1.vi.fn(), warn: vitest_1.vi.fn() },
}));
const database_1 = require("../../../config/database");
const repository_1 = require("../repository");
const repository_2 = require("../../partido/repository");
const service_2 = require("../../notification/service");
const logger_1 = require("../../../config/logger");
const divisionId = 'div-test-1';
const owner = { id: 'user-1', email: 'owner@test.com', rol: 'LIGA' };
function generateNext(_divisionId, slots) {
    return service_1.jornadaService.generateNext(divisionId, owner, slots);
}
const jornadaService = { ...service_1.jornadaService, generateNext };
const TEAMS = [
    { id: 't1', nombre: 'Águilas' },
    { id: 't2', nombre: 'Dragones' },
    { id: 't3', nombre: 'Genix' },
    { id: 't4', nombre: 'Mi Equipo' },
    { id: 't5', nombre: 'Leones' },
    { id: 't6', nombre: 'Tiburones' },
    { id: 't7', nombre: 'Panteras' },
];
function mockDivision(opts) {
    database_1.prisma.division.findUnique.mockImplementation(async (query) => {
        if (query.select?.liga && !query.select?.diasPartido)
            return { liga: { userId: owner.id } };
        return {
            maxEquipos: opts?.maxEquipos ?? 7,
            diasPartido: opts?.diasPartido ?? null,
            duracionPartido: null,
            ligaId: 'liga-1',
            liga: { userId: owner.id },
        };
    });
}
function mockTeams(ids) {
    const selected = ids ? TEAMS.filter((t) => ids.includes(t.id)) : TEAMS;
    database_1.prisma.divisionEquipo.findMany.mockResolvedValue(selected.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })));
}
function mockNoPreviousJornadas() {
    repository_1.jornadaRepository.findByDivision.mockResolvedValue({ rows: [] });
}
function mockJornadaCreated(numero = 1) {
    const jornada = { id: 'j-new-1', numero, divisionId };
    repository_1.jornadaRepository.create.mockResolvedValue(jornada);
    return jornada;
}
function mockPartidosCreatedReturn(count) {
    database_1.prisma.partido.findMany.mockResolvedValue(Array.from({ length: count }, () => ({ fecha: new Date('2026-07-02T18:00:00') })));
}
function expectMatch(calls, localId, visitaId, tipo) {
    return calls.some(([args]) => args.equipoLocalId === localId
        && args.equipoVisitanteId === visitaId
        && (tipo === undefined || args.tipoPartido === tipo));
}
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.resetAllMocks();
    database_1.prisma.rondaPlayoff.findMany.mockResolvedValue([]);
    database_1.prisma.rondaPlayoff.findFirst.mockImplementation(async () => {
        const rows = await database_1.prisma.rondaPlayoff.findMany();
        return rows[0] ?? null;
    });
    repository_1.jornadaRepository.findGenerationHistory.mockImplementation(async () => {
        const result = await repository_1.jornadaRepository.findByDivision();
        return result?.rows ?? [];
    });
    database_1.prisma.partido.findMany.mockImplementation(async (query) => {
        if (!query?.where?.id?.in)
            return [];
        const rows = await Promise.all(query.where.id.in.map((id) => repository_2.partidoRepository.findById(id)));
        return rows.filter(Boolean);
    });
    database_1.prisma.partido.update.mockImplementation(async ({ where, data }) => repository_2.partidoRepository.update(where.id, data));
    database_1.prisma.partido.createMany.mockImplementation(async ({ data }) => {
        for (const partido of data)
            await repository_2.partidoRepository.create(partido);
        return { count: data.length };
    });
    database_1.prisma.$transaction.mockImplementation(async (callback) => callback({
        jornada: {
            create: vitest_1.vi.fn(async ({ data }) => repository_1.jornadaRepository.create(data)),
        },
        partido: {
            update: database_1.prisma.partido.update,
            createMany: database_1.prisma.partido.createMany,
        },
    }));
    service_2.notificationService.notifyJornadaGenerated.mockResolvedValue(undefined);
});
(0, vitest_1.describe)('generateNext', () => {
    (0, vitest_1.it)('logs one structured completion event without generation diagnostics', async () => {
        mockDivision();
        mockTeams(['t1', 't2']);
        mockNoPreviousJornadas();
        mockJornadaCreated();
        mockPartidosCreatedReturn(1);
        await jornadaService.generateNext(divisionId);
        (0, vitest_1.expect)(logger_1.logger.info).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(logger_1.logger.info).toHaveBeenCalledWith({
            divisionId,
            jornadaId: 'j-new-1',
            counts: { created: 1, playoffUpdated: 0, total: 1 },
            durationMs: vitest_1.expect.any(Number),
        }, 'Jornada generation completed');
    });
    (0, vitest_1.it)('keeps the regular generation query budget constant and batches writes', async () => {
        mockDivision({ maxEquipos: 6 });
        mockTeams(['t1', 't2', 't3', 't4', 't5', 't6']);
        mockNoPreviousJornadas();
        mockJornadaCreated();
        await jornadaService.generateNext(divisionId);
        (0, vitest_1.expect)(database_1.prisma.division.findUnique).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(database_1.prisma.rondaPlayoff.findFirst).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(repository_1.jornadaRepository.findGenerationHistory).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(database_1.prisma.divisionEquipo.findMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(database_1.prisma.partido.findMany).not.toHaveBeenCalled();
        (0, vitest_1.expect)(database_1.prisma.$transaction).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(database_1.prisma.partido.createMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(repository_2.partidoRepository.findById).not.toHaveBeenCalled();
        (0, vitest_1.expect)(repository_2.partidoRepository.create).toHaveBeenCalledTimes(3);
    });
    (0, vitest_1.it)('handles detached notification rejection with a structured warning', async () => {
        const notificationError = new Error('push failed');
        service_2.notificationService.notifyJornadaGenerated.mockRejectedValue(notificationError);
        mockDivision();
        mockTeams(['t1', 't2']);
        mockNoPreviousJornadas();
        mockJornadaCreated();
        mockPartidosCreatedReturn(1);
        await jornadaService.generateNext(divisionId);
        await Promise.resolve();
        (0, vitest_1.expect)(logger_1.logger.warn).toHaveBeenCalledWith({
            event: 'notification.failed',
            provider: 'onesignal',
            divisionId,
            jornadaId: 'j-new-1',
        }, 'Jornada generation notification failed');
    });
    (0, vitest_1.it)('lanza ValidationError si hay menos de 2 equipos', async () => {
        mockDivision();
        mockTeams(['t1']);
        mockNoPreviousJornadas();
        mockJornadaCreated();
        await (0, vitest_1.expect)(jornadaService.generateNext(divisionId)).rejects.toThrow('Se necesitan al menos 2 equipos');
    });
    (0, vitest_1.it)('8 equipos sin slots → 4 partidos round-robin', async () => {
        const eightTeams = [
            ...TEAMS,
            { id: 't8', nombre: 'Rayos' },
        ];
        mockDivision({ maxEquipos: 8, diasPartido: null });
        database_1.prisma.divisionEquipo.findMany.mockResolvedValue(eightTeams.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })));
        mockNoPreviousJornadas();
        mockJornadaCreated();
        mockPartidosCreatedReturn(4);
        await jornadaService.generateNext(divisionId);
        const calls = repository_2.partidoRepository.create.mock.calls;
        (0, vitest_1.expect)(calls.length).toBe(4);
        const allTeams = new Set(calls.map(([args]) => args.equipoLocalId).concat(calls.map(([args]) => args.equipoVisitanteId)));
        eightTeams.forEach((t) => (0, vitest_1.expect)(allTeams.has(t.id)).toBe(true));
    });
    (0, vitest_1.it)('7 equipos sin slots → 3 partidos (1 descansa)', async () => {
        mockDivision();
        mockTeams();
        mockNoPreviousJornadas();
        mockJornadaCreated();
        mockPartidosCreatedReturn(3);
        await jornadaService.generateNext(divisionId);
        const calls = repository_2.partidoRepository.create.mock.calls;
        (0, vitest_1.expect)(calls.length).toBe(3);
        const usedTeams = new Set(calls.map(([args]) => args.equipoLocalId).concat(calls.map(([args]) => args.equipoVisitanteId)));
        (0, vitest_1.expect)(usedTeams.size).toBe(6);
        (0, vitest_1.expect)(usedTeams.has('DESCANSO')).toBe(false);
    });
    (0, vitest_1.it)('7 equipos + 1 slot normal completo → slot respetado', async () => {
        mockDivision();
        mockTeams();
        mockNoPreviousJornadas();
        mockJornadaCreated();
        mockPartidosCreatedReturn(3);
        await jornadaService.generateNext(divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1', equipoVisitanteId: 't2' },
        ]);
        const calls = repository_2.partidoRepository.create.mock.calls;
        (0, vitest_1.expect)(calls.length).toBe(3);
        (0, vitest_1.expect)(expectMatch(calls, 't1', 't2', 'REGULAR')).toBe(true);
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
        mockDivision();
        mockTeams();
        mockNoPreviousJornadas();
        mockJornadaCreated();
        mockPartidosCreatedReturn(4);
        await jornadaService.generateNext(divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento', equipoLocalId: 't4' },
        ]);
        const calls = repository_2.partidoRepository.create.mock.calls;
        const compMatch = calls.find(([args]) => args.equipoLocalId === 't4');
        (0, vitest_1.expect)(compMatch).toBeDefined();
        const [compArgs] = compMatch;
        (0, vitest_1.expect)(compArgs.tipoPartido).toBe('COMPLEMENTO');
    });
    (0, vitest_1.it)('complemento vacío → ValidationError', async () => {
        mockDivision();
        mockTeams();
        mockNoPreviousJornadas();
        mockJornadaCreated();
        await (0, vitest_1.expect)(jornadaService.generateNext(divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento' },
        ])).rejects.toThrow('debe tener al menos el equipo que obtiene puntos');
    });
    (0, vitest_1.it)('amistoso sin equipos → ValidationError', async () => {
        mockDivision();
        mockTeams();
        mockNoPreviousJornadas();
        mockJornadaCreated();
        await (0, vitest_1.expect)(jornadaService.generateNext(divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'amistoso' },
        ])).rejects.toThrow('debe tener ambos equipos asignados');
    });
    (0, vitest_1.it)('amistoso con un solo equipo → ValidationError', async () => {
        mockDivision();
        mockTeams();
        mockNoPreviousJornadas();
        mockJornadaCreated();
        await (0, vitest_1.expect)(jornadaService.generateNext(divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'amistoso', equipoLocalId: 't1' },
        ])).rejects.toThrow('debe tener ambos equipos asignados');
    });
    (0, vitest_1.it)('mismo equipo en 2 slots normales → ValidationError', async () => {
        mockDivision();
        mockTeams();
        mockNoPreviousJornadas();
        mockJornadaCreated();
        await (0, vitest_1.expect)(jornadaService.generateNext(divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1', equipoVisitanteId: 't2' },
            { fecha: '2099-01-01', horaInicio: '19:30', horaFin: '21:00', equipoLocalId: 't1', equipoVisitanteId: 't3' },
        ])).rejects.toThrow('ya está asignado a otro horario');
    });
    (0, vitest_1.it)('mismo equipo en normal + complemento → permitido (puntos puede repetirse)', async () => {
        mockDivision();
        mockTeams();
        mockNoPreviousJornadas();
        mockJornadaCreated();
        mockPartidosCreatedReturn(4);
        await jornadaService.generateNext(divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1', equipoVisitanteId: 't2' },
            { fecha: '2099-01-01', horaInicio: '19:30', horaFin: '21:00', tipo: 'complemento', equipoLocalId: 't1' },
        ]);
        const calls = repository_2.partidoRepository.create.mock.calls;
        const compMatch = calls.find(([args]) => args.tipoPartido === 'COMPLEMENTO');
        (0, vitest_1.expect)(compMatch).toBeDefined();
    });
    (0, vitest_1.it)('más pairings que slots en plan → padding', async () => {
        mockDivision();
        mockTeams();
        mockNoPreviousJornadas();
        mockJornadaCreated();
        mockPartidosCreatedReturn(4);
        await jornadaService.generateNext(divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1', equipoVisitanteId: 't2' },
            { fecha: '2099-01-01', horaInicio: '19:30', horaFin: '21:00', tipo: 'complemento', equipoLocalId: 't3' },
        ]);
        const calls = repository_2.partidoRepository.create.mock.calls;
        (0, vitest_1.expect)(calls.length).toBe(4);
    });
    (0, vitest_1.it)('flags correctos: Puntos en complemento suma, Sin puntos no suma', async () => {
        mockDivision();
        mockTeams();
        mockNoPreviousJornadas();
        mockJornadaCreated();
        mockPartidosCreatedReturn(4);
        await jornadaService.generateNext(divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento', equipoLocalId: 't4' },
        ]);
        const calls = repository_2.partidoRepository.create.mock.calls;
        const compMatch = calls.find(([args]) => args.equipoLocalId === 't4');
        (0, vitest_1.expect)(compMatch).toBeDefined();
        const [compArgs] = compMatch;
        (0, vitest_1.expect)(compArgs.tipoPartido).toBe('COMPLEMENTO');
    });
    (0, vitest_1.it)('complemento con ambos equipos asignados → Puntos y Sin puntos preservan tipo', async () => {
        mockDivision();
        mockTeams();
        mockNoPreviousJornadas();
        mockJornadaCreated();
        mockPartidosCreatedReturn(4);
        await jornadaService.generateNext(divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento', equipoLocalId: 't4', equipoVisitanteId: 't5' },
        ]);
        const calls = repository_2.partidoRepository.create.mock.calls;
        const comp = calls.find(([args]) => args.equipoLocalId === 't4' && args.equipoVisitanteId === 't5');
        (0, vitest_1.expect)(comp).toBeDefined();
        const [compArgs] = comp;
        (0, vitest_1.expect)(compArgs.tipoPartido).toBe('COMPLEMENTO');
    });
    (0, vitest_1.it)('2 complementos con 1 equipo cada uno → excluye del RR, flags correctos', async () => {
        mockDivision();
        mockTeams();
        mockNoPreviousJornadas();
        mockJornadaCreated();
        mockPartidosCreatedReturn(4);
        await jornadaService.generateNext(divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'complemento', equipoLocalId: 't4' },
            { fecha: '2099-01-01', horaInicio: '19:30', horaFin: '21:00', tipo: 'complemento', equipoLocalId: 't5' },
        ]);
        const calls = repository_2.partidoRepository.create.mock.calls;
        const t4Comp = calls.find(([args]) => args.equipoLocalId === 't4');
        (0, vitest_1.expect)(t4Comp).toBeDefined();
        const [t4Args] = t4Comp;
        (0, vitest_1.expect)(t4Args.tipoPartido).toBe('COMPLEMENTO');
        const t5Comp = calls.find(([args]) => args.equipoLocalId === 't5');
        (0, vitest_1.expect)(t5Comp).toBeDefined();
        const [t5Args] = t5Comp;
        (0, vitest_1.expect)(t5Args.tipoPartido).toBe('COMPLEMENTO');
    });
    (0, vitest_1.it)('rotación con jornadas previas (r=4) → pairings diferentes a J1', async () => {
        mockDivision();
        mockTeams();
        repository_1.jornadaRepository.findByDivision.mockResolvedValue({
            rows: [1, 2, 3, 4].map((numero) => ({
                numero,
                partidos: [{ equipoLocalId: 'history-a', equipoVisitanteId: 'history-b', tipoPartido: 'REGULAR' }],
            })),
        });
        mockJornadaCreated(5);
        mockPartidosCreatedReturn(3);
        await jornadaService.generateNext(divisionId);
        const calls = repository_2.partidoRepository.create.mock.calls;
        (0, vitest_1.expect)(calls.length).toBe(3);
        // r=4 → t1 vs t6 (no t1 vs t2 como en J1)
        const hasT1vsT2 = calls.some(([args]) => args.equipoLocalId === 't1' && args.equipoVisitanteId === 't2');
        (0, vitest_1.expect)(hasT1vsT2).toBe(false);
        // Verificar que rotó: algún pairing esperado con r=4
        const hasT1vsT6 = calls.some(([args]) => (args.equipoLocalId === 't1' && args.equipoVisitanteId === 't6') || (args.equipoLocalId === 't6' && args.equipoVisitanteId === 't1'));
        (0, vitest_1.expect)(hasT1vsT6).toBe(true);
    });
    (0, vitest_1.it)('5 equipos sin slots → 2 partidos + 1 descanso', async () => {
        mockDivision({ maxEquipos: 5, diasPartido: null });
        database_1.prisma.divisionEquipo.findMany.mockResolvedValue(TEAMS.slice(0, 5).map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })));
        mockNoPreviousJornadas();
        mockJornadaCreated();
        mockPartidosCreatedReturn(2);
        await jornadaService.generateNext(divisionId);
        const calls = repository_2.partidoRepository.create.mock.calls;
        (0, vitest_1.expect)(calls.length).toBe(2);
        const usedTeams = new Set(calls.map(([args]) => args.equipoLocalId).concat(calls.map(([args]) => args.equipoVisitanteId)));
        (0, vitest_1.expect)(usedTeams.size).toBe(4);
        (0, vitest_1.expect)(usedTeams.has('DESCANSO')).toBe(false);
    });
    (0, vitest_1.it)('slots=[] (array vacío) → mismo que undefined', async () => {
        mockDivision();
        mockTeams();
        mockNoPreviousJornadas();
        mockJornadaCreated();
        mockPartidosCreatedReturn(3);
        await jornadaService.generateNext(divisionId, []);
        const calls = repository_2.partidoRepository.create.mock.calls;
        (0, vitest_1.expect)(calls.length).toBe(3);
    });
    (0, vitest_1.it)('slot parcial con historial previo → no repite el mismo rival de J1', async () => {
        mockDivision({ maxEquipos: 6, diasPartido: null });
        const sixTeams = TEAMS.slice(0, 6);
        database_1.prisma.divisionEquipo.findMany.mockResolvedValue(sixTeams.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })));
        // J1 had t1 vs t2
        repository_1.jornadaRepository.findByDivision.mockResolvedValue({
            rows: [{
                    numero: 1,
                    partidos: [{
                            equipoLocalId: 't1',
                            equipoVisitanteId: 't2',
                            tipoPartido: 'REGULAR',
                        }],
                }],
        });
        mockJornadaCreated(2);
        mockPartidosCreatedReturn(3);
        await jornadaService.generateNext(divisionId, [
            { fecha: '2099-01-08', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1' },
        ]);
        const calls = repository_2.partidoRepository.create.mock.calls;
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
        mockDivision({ maxEquipos: 6, diasPartido: null });
        const sixTeams = TEAMS.slice(0, 6);
        database_1.prisma.divisionEquipo.findMany.mockResolvedValue(sixTeams.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })));
        // J1 had t2 vs t1 (reverse orientation)
        repository_1.jornadaRepository.findByDivision.mockResolvedValue({
            rows: [{
                    numero: 1,
                    partidos: [{
                            equipoLocalId: 't2',
                            equipoVisitanteId: 't1',
                            tipoPartido: 'REGULAR',
                        }],
                }],
        });
        mockJornadaCreated(2);
        mockPartidosCreatedReturn(3);
        await jornadaService.generateNext(divisionId, [
            { fecha: '2099-01-08', horaInicio: '18:00', horaFin: '19:30', equipoVisitanteId: 't1' },
        ]);
        const calls = repository_2.partidoRepository.create.mock.calls;
        (0, vitest_1.expect)(calls.length).toBe(3);
        const t1Match = calls.find(([args]) => args.equipoLocalId === 't1' || args.equipoVisitanteId === 't1');
        (0, vitest_1.expect)(t1Match).toBeDefined();
        const [t1Args] = t1Match;
        const opponent = t1Args.equipoLocalId === 't1' ? t1Args.equipoVisitanteId : t1Args.equipoLocalId;
        (0, vitest_1.expect)(opponent).not.toBe('t2');
    });
    (0, vitest_1.it)('amistoso previo no bloquea cruce regular', async () => {
        mockDivision();
        mockTeams();
        repository_1.jornadaRepository.findByDivision.mockResolvedValue({
            rows: [{
                    numero: 1,
                    partidos: [{
                            equipoLocalId: 't1',
                            equipoVisitanteId: 't2',
                            tipoPartido: 'AMISTOSO',
                        }],
                }],
        });
        mockJornadaCreated(2);
        mockPartidosCreatedReturn(3);
        await jornadaService.generateNext(divisionId, [
            { fecha: '2099-01-08', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1' },
        ]);
        const calls = repository_2.partidoRepository.create.mock.calls;
        const t1Match = calls.find(([args]) => args.equipoLocalId === 't1' || args.equipoVisitanteId === 't1');
        (0, vitest_1.expect)(t1Match).toBeDefined();
        const [t1Args] = t1Match;
        const opponent = t1Args.equipoLocalId === 't1' ? t1Args.equipoVisitanteId : t1Args.equipoLocalId;
        // The friendly jornada must not advance the regular rotation: r=0 still pairs t1 vs t2.
        (0, vitest_1.expect)(opponent).toBe('t2');
    });
    (0, vitest_1.it)('ciclo completo 6 equipos sin slots → 15 pairings únicos en 5 jornadas', async () => {
        mockDivision({ maxEquipos: 6, diasPartido: null });
        const sixTeams = TEAMS.slice(0, 6);
        database_1.prisma.divisionEquipo.findMany.mockResolvedValue(sixTeams.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })));
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
                repository_1.jornadaRepository.findByDivision.mockResolvedValue({ rows: prev });
            }
            else {
                mockNoPreviousJornadas();
            }
            mockJornadaCreated(j);
            mockPartidosCreatedReturn(3);
            await jornadaService.generateNext(divisionId);
            const calls = repository_2.partidoRepository.create.mock.calls;
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
    (0, vitest_1.it)('slot normal parcial (solo local) → se llena del pool', async () => {
        mockDivision();
        mockTeams();
        mockNoPreviousJornadas();
        mockJornadaCreated();
        mockPartidosCreatedReturn(3);
        await jornadaService.generateNext(divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1' },
        ]);
        const calls = repository_2.partidoRepository.create.mock.calls;
        (0, vitest_1.expect)(calls.length).toBe(3);
        const matchWithT1 = calls.find(([args]) => args.equipoLocalId === 't1' || args.equipoVisitanteId === 't1');
        (0, vitest_1.expect)(matchWithT1).toBeDefined();
        // t1 should not be in any other match
        const t1Count = calls.filter(([args]) => args.equipoLocalId === 't1' || args.equipoVisitanteId === 't1').length;
        (0, vitest_1.expect)(t1Count).toBe(1);
    });
    (0, vitest_1.it)('mixed jornada: regular + amistoso + complemento, each preserves tipoPartido', async () => {
        const sixTeams = TEAMS.slice(0, 6);
        mockDivision({ maxEquipos: 6, diasPartido: null });
        database_1.prisma.divisionEquipo.findMany.mockResolvedValue(sixTeams.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })));
        mockNoPreviousJornadas();
        mockJornadaCreated();
        mockPartidosCreatedReturn(5);
        await jornadaService.generateNext(divisionId, [
            { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', equipoLocalId: 't1', equipoVisitanteId: 't2' },
            { fecha: '2099-01-01', horaInicio: '19:30', horaFin: '21:00', tipo: 'amistoso', equipoLocalId: 't3', equipoVisitanteId: 't4' },
            { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'complemento', equipoLocalId: 't5', equipoVisitanteId: 't6' },
        ]);
        const calls = repository_2.partidoRepository.create.mock.calls;
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
    (0, vitest_1.describe)('conflictos de cancha', () => {
        function mockCanchas() {
            database_1.prisma.ligaCancha.findMany.mockResolvedValue([
                { id: 'c1', nombre: 'Cancha 1' },
                { id: 'c2', nombre: 'Cancha 2' },
            ]);
        }
        (0, vitest_1.it)('rechaza horarios solapados cuando no hay canchas configuradas', async () => {
            mockDivision({ maxEquipos: 4, diasPartido: null });
            mockTeams(['t1', 't2', 't3', 't4']);
            mockNoPreviousJornadas();
            mockJornadaCreated();
            await (0, vitest_1.expect)(jornadaService.generateNext(divisionId, [
                { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2' },
                { fecha: '2099-01-01', horaInicio: '18:30', horaFin: '19:30', equipoLocalId: 't3', equipoVisitanteId: 't4' },
            ])).rejects.toThrow('Hay partidos con horarios solapados');
        });
        (0, vitest_1.it)('permite horarios consecutivos cuando no hay canchas configuradas', async () => {
            mockDivision({ maxEquipos: 4, diasPartido: null });
            mockTeams(['t1', 't2', 't3', 't4']);
            mockNoPreviousJornadas();
            mockJornadaCreated();
            mockPartidosCreatedReturn(2);
            await jornadaService.generateNext(divisionId, [
                { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2' },
                { fecha: '2099-01-01', horaInicio: '19:00', horaFin: '20:00', tipo: 'amistoso', equipoLocalId: 't3', equipoVisitanteId: 't4' },
            ]);
            (0, vitest_1.expect)(repository_2.partidoRepository.create).toHaveBeenCalled();
        });
        (0, vitest_1.it)('rechaza dos tipos de partido solapados en la misma cancha', async () => {
            mockDivision({ maxEquipos: 4, diasPartido: null });
            mockTeams(['t1', 't2', 't3', 't4']);
            mockNoPreviousJornadas();
            mockJornadaCreated();
            mockCanchas();
            database_1.prisma.partido.findMany.mockResolvedValue([]);
            await (0, vitest_1.expect)(jornadaService.generateNext(divisionId, [
                { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' },
                { fecha: '2099-01-01', horaInicio: '18:30', horaFin: '19:30', equipoLocalId: 't3', equipoVisitanteId: 't4', canchaId: 'c1' },
            ])).rejects.toThrow('horarios solapados');
        });
        (0, vitest_1.it)('permite partidos simultáneos en canchas diferentes', async () => {
            mockDivision({ maxEquipos: 4, diasPartido: null });
            mockTeams(['t1', 't2', 't3', 't4']);
            mockNoPreviousJornadas();
            mockJornadaCreated();
            mockCanchas();
            database_1.prisma.partido.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([{ fecha: new Date('2099-01-01T18:00:00'), fechaFin: new Date('2099-01-01T19:00:00') }]);
            await jornadaService.generateNext(divisionId, [
                { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' },
                { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't3', equipoVisitanteId: 't4', canchaId: 'c2' },
            ]);
            (0, vitest_1.expect)(repository_2.partidoRepository.create).toHaveBeenCalled();
        });
        (0, vitest_1.it)('permite partidos consecutivos en la misma cancha', async () => {
            mockDivision({ maxEquipos: 4, diasPartido: null });
            mockTeams(['t1', 't2', 't3', 't4']);
            mockNoPreviousJornadas();
            mockJornadaCreated();
            mockCanchas();
            database_1.prisma.partido.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([{ fecha: new Date('2099-01-01T18:00:00'), fechaFin: new Date('2099-01-01T20:00:00') }]);
            await jornadaService.generateNext(divisionId, [
                { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' },
                { fecha: '2099-01-01', horaInicio: '19:00', horaFin: '20:00', tipo: 'amistoso', equipoLocalId: 't3', equipoVisitanteId: 't4', canchaId: 'c1' },
            ]);
            (0, vitest_1.expect)(repository_2.partidoRepository.create).toHaveBeenCalled();
        });
        (0, vitest_1.it)('rechaza conflicto con partido existente de otra división', async () => {
            mockDivision({ maxEquipos: 4, diasPartido: null });
            mockTeams(['t1', 't2']);
            mockNoPreviousJornadas();
            mockJornadaCreated();
            mockCanchas();
            database_1.prisma.partido.findMany.mockResolvedValueOnce([
                { id: 'partido-otra-division', canchaId: 'c1', fecha: new Date(2099, 0, 1, 18, 30), fechaFin: new Date(2099, 0, 1, 19, 30) },
            ]);
            await (0, vitest_1.expect)(jornadaService.generateNext(divisionId, [
                { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2', canchaId: 'c1' },
            ])).rejects.toThrow('ya tiene otro partido programado');
        });
    });
    (0, vitest_1.describe)('playoff mode — amistosos auto-fill', () => {
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
            database_1.prisma.rondaPlayoff.findMany.mockResolvedValue([{ id: 'r1' }]);
        }
        function mockTenTeams() {
            database_1.prisma.divisionEquipo.findMany.mockResolvedValue(TEN_TEAMS.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })));
        }
        function mockEliminatoriaPartidos() {
            repository_2.partidoRepository.findById.mockImplementation((id) => {
                const slot = ELIM_SLOTS.find((s) => s.partidoId === id);
                if (!slot)
                    return null;
                return { id, equipoLocalId: slot.equipoLocalId, equipoVisitanteId: slot.equipoVisitanteId, jornadaId: null };
            });
        }
        (0, vitest_1.it)('incluye eliminatorias en conflictos de la misma cancha y excluye el propio partido de la consulta', async () => {
            mockDivision({ maxEquipos: 10, diasPartido: null });
            mockPlayoffMode();
            mockTenTeams();
            mockEliminatoriaPartidos();
            mockNoPreviousJornadas();
            mockJornadaCreated();
            database_1.prisma.ligaCancha.findMany.mockResolvedValue([{ id: 'c1', nombre: 'Cancha 1' }]);
            database_1.prisma.partido.findMany
                .mockResolvedValueOnce([{ id: 'p1', equipoLocalId: 't1', equipoVisitanteId: 't2', jornadaId: null }])
                .mockResolvedValueOnce([]);
            await (0, vitest_1.expect)(jornadaService.generateNext(divisionId, [
                { ...ELIM_SLOTS[0], canchaId: 'c1' },
                { fecha: '2099-01-01', horaInicio: '18:30', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't3', equipoVisitanteId: 't4', canchaId: 'c1' },
            ])).rejects.toThrow('horarios solapados');
            (0, vitest_1.expect)(database_1.prisma.partido.findMany).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
                where: vitest_1.expect.objectContaining({ id: { notIn: ['p1'] } }),
            }));
            (0, vitest_1.expect)(repository_2.partidoRepository.update).not.toHaveBeenCalled();
        });
        (0, vitest_1.it)('3 amistosos vacíos con 10 equipos y 4 en eliminatoria → usa 6 equipos libres', async () => {
            mockDivision({ maxEquipos: 10, diasPartido: null });
            mockPlayoffMode();
            mockTenTeams();
            mockEliminatoriaPartidos();
            mockNoPreviousJornadas();
            mockJornadaCreated();
            await jornadaService.generateNext(divisionId, [
                ...ELIM_SLOTS,
                { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso' },
                { fecha: '2099-01-01', horaInicio: '22:30', horaFin: '00:00', tipo: 'amistoso' },
                { fecha: '2099-01-01', horaInicio: '00:00', horaFin: '01:30', tipo: 'amistoso' },
            ]);
            const calls = repository_2.partidoRepository.create.mock.calls;
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
            mockDivision({ maxEquipos: 10, diasPartido: null });
            mockPlayoffMode();
            mockTenTeams();
            mockEliminatoriaPartidos();
            mockNoPreviousJornadas();
            mockJornadaCreated();
            // Only non-eliminatoria teams: t5, t6, t7, t8, t9, t10
            // 3 amistosos need 6 teams, but we have only 6 free ones.
            // 4th amistoso would need eliminatoria teams
            await jornadaService.generateNext(divisionId, [
                ...ELIM_SLOTS,
                { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso' },
                { fecha: '2099-01-01', horaInicio: '22:30', horaFin: '00:00', tipo: 'amistoso' },
                { fecha: '2099-01-01', horaInicio: '00:00', horaFin: '01:30', tipo: 'amistoso' },
                { fecha: '2099-01-01', horaInicio: '01:30', horaFin: '03:00', tipo: 'amistoso' },
            ]);
            const calls = repository_2.partidoRepository.create.mock.calls;
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
            mockDivision({ maxEquipos: 10, diasPartido: null });
            mockPlayoffMode();
            mockTenTeams();
            mockEliminatoriaPartidos();
            mockNoPreviousJornadas();
            mockJornadaCreated();
            await (0, vitest_1.expect)(jornadaService.generateNext(divisionId, [
                ...ELIM_SLOTS,
                { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2' },
            ])).rejects.toThrow('repite el mismo cruce que un partido de eliminatoria');
        });
        (0, vitest_1.it)('amistoso parcial evita duplicado de cruce eliminatoria', async () => {
            mockDivision({ maxEquipos: 10, diasPartido: null });
            mockPlayoffMode();
            mockTenTeams();
            mockEliminatoriaPartidos();
            mockNoPreviousJornadas();
            mockJornadaCreated();
            // Amistoso parcial: t1 assigned, need opponent. t2 is the eliminatoria opponent → should NOT pick t2
            await jornadaService.generateNext(divisionId, [
                ...ELIM_SLOTS,
                { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't1' },
            ]);
            const calls = repository_2.partidoRepository.create.mock.calls;
            const amistoso = calls.find(([args]) => args.tipoPartido === 'AMISTOSO');
            (0, vitest_1.expect)(amistoso).toBeDefined();
            // Should NOT pair t1 with t2 (eliminatoria duplicate)
            (0, vitest_1.expect)(amistoso[0].equipoLocalId === 't1' && amistoso[0].equipoVisitanteId === 't2').toBe(false);
            (0, vitest_1.expect)(amistoso[0].equipoVisitanteId === 't1' && amistoso[0].equipoLocalId === 't2').toBe(false);
        });
        (0, vitest_1.it)('no hay suficientes equipos para amistosos → ValidationError', async () => {
            mockDivision({ maxEquipos: 10, diasPartido: null });
            mockPlayoffMode();
            // Only 2 teams total, 1 eliminatoria (t1 vs t2), 1 empty amistoso
            // The only possible pairing t1 vs t2 would duplicate the eliminatoria match
            database_1.prisma.divisionEquipo.findMany.mockResolvedValue(TEN_TEAMS.slice(0, 2).map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })));
            repository_2.partidoRepository.findById.mockImplementation((id) => {
                const slot = ELIM_SLOTS.find((s) => s.partidoId === id);
                if (!slot)
                    return null;
                // Only return the first eliminatoria slot
                if (id === 'p2')
                    return null;
                return { id, equipoLocalId: slot.equipoLocalId, equipoVisitanteId: slot.equipoVisitanteId, jornadaId: null };
            });
            mockNoPreviousJornadas();
            mockJornadaCreated();
            await (0, vitest_1.expect)(jornadaService.generateNext(divisionId, [
                { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'eliminatoria', partidoId: 'p1', equipoLocalId: 't1', equipoVisitanteId: 't2' },
                { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso' },
            ])).rejects.toThrow('No hay combinaciones disponibles');
        });
        (0, vitest_1.it)('sin playoff mode, amistoso vacío sigue fallando', async () => {
            mockDivision();
            mockTeams();
            mockNoPreviousJornadas();
            mockJornadaCreated();
            await (0, vitest_1.expect)(jornadaService.generateNext(divisionId, [
                { fecha: '2099-01-01', horaInicio: '18:00', horaFin: '19:30', tipo: 'amistoso' },
            ])).rejects.toThrow('debe tener ambos equipos asignados');
        });
        (0, vitest_1.it)('un equipo puede jugar dos amistosos si las parejas son distintas', async () => {
            mockDivision({ maxEquipos: 10, diasPartido: null });
            mockPlayoffMode();
            mockTenTeams();
            mockEliminatoriaPartidos();
            mockNoPreviousJornadas();
            mockJornadaCreated();
            await jornadaService.generateNext(divisionId, [
                ...ELIM_SLOTS,
                { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't5', equipoVisitanteId: 't6' },
                { fecha: '2099-01-01', horaInicio: '22:30', horaFin: '00:00', tipo: 'amistoso', equipoLocalId: 't7', equipoVisitanteId: 't8' },
                { fecha: '2099-01-01', horaInicio: '00:00', horaFin: '01:30', tipo: 'amistoso', equipoLocalId: 't5' },
            ]);
            const amistosos = repository_2.partidoRepository.create.mock.calls
                .filter(([args]) => args.tipoPartido === 'AMISTOSO');
            (0, vitest_1.expect)(amistosos).toHaveLength(3);
            const t5Matches = amistosos.filter(([args]) => args.equipoLocalId === 't5' || args.equipoVisitanteId === 't5');
            (0, vitest_1.expect)(t5Matches).toHaveLength(2);
            const pairKeys = amistosos.map(([args]) => [args.equipoLocalId, args.equipoVisitanteId].sort().join('-'));
            (0, vitest_1.expect)(new Set(pairKeys).size).toBe(pairKeys.length);
        });
        (0, vitest_1.it)('dos amistosos completos pueden repetir equipo con parejas distintas', async () => {
            mockDivision({ maxEquipos: 10, diasPartido: null });
            mockPlayoffMode();
            mockTenTeams();
            mockEliminatoriaPartidos();
            mockNoPreviousJornadas();
            mockJornadaCreated();
            await jornadaService.generateNext(divisionId, [
                ...ELIM_SLOTS,
                { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't5', equipoVisitanteId: 't6' },
                { fecha: '2099-01-01', horaInicio: '22:30', horaFin: '00:00', tipo: 'amistoso', equipoLocalId: 't5', equipoVisitanteId: 't7' },
            ]);
            const amistosos = repository_2.partidoRepository.create.mock.calls
                .filter(([args]) => args.tipoPartido === 'AMISTOSO');
            (0, vitest_1.expect)(amistosos).toHaveLength(2);
        });
        (0, vitest_1.it)('dos amistosos no pueden repetir la misma pareja invertida', async () => {
            mockDivision({ maxEquipos: 10, diasPartido: null });
            mockPlayoffMode();
            mockTenTeams();
            mockEliminatoriaPartidos();
            mockNoPreviousJornadas();
            mockJornadaCreated();
            await (0, vitest_1.expect)(jornadaService.generateNext(divisionId, [
                ...ELIM_SLOTS,
                { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't5', equipoVisitanteId: 't6' },
                { fecha: '2099-01-01', horaInicio: '22:30', horaFin: '00:00', tipo: 'amistoso', equipoLocalId: 't6', equipoVisitanteId: 't5' },
            ])).rejects.toThrow('misma pareja');
            (0, vitest_1.expect)(repository_2.partidoRepository.update).not.toHaveBeenCalled();
        });
        (0, vitest_1.it)('amistoso manual no permite el mismo equipo en ambos lados', async () => {
            mockDivision({ maxEquipos: 10, diasPartido: null });
            mockPlayoffMode();
            mockTenTeams();
            mockEliminatoriaPartidos();
            mockNoPreviousJornadas();
            mockJornadaCreated();
            await (0, vitest_1.expect)(jornadaService.generateNext(divisionId, [
                ...ELIM_SLOTS,
                { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't5', equipoVisitanteId: 't5' },
            ])).rejects.toThrow('contra sí mismo');
        });
        (0, vitest_1.it)('amistoso manual rechaza equipos no habilitados', async () => {
            mockDivision({ maxEquipos: 10, diasPartido: null });
            mockPlayoffMode();
            mockTenTeams();
            mockEliminatoriaPartidos();
            mockNoPreviousJornadas();
            mockJornadaCreated();
            await (0, vitest_1.expect)(jornadaService.generateNext(divisionId, [
                ...ELIM_SLOTS,
                { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't5', equipoVisitanteId: 'no-habilitado' },
            ])).rejects.toThrow('no está habilitado');
        });
        (0, vitest_1.it)('usa el cruce autoritativo de eliminatoria aunque el slot esté desactualizado', async () => {
            mockDivision({ maxEquipos: 10, diasPartido: null });
            mockPlayoffMode();
            mockTenTeams();
            mockEliminatoriaPartidos();
            mockNoPreviousJornadas();
            mockJornadaCreated();
            await (0, vitest_1.expect)(jornadaService.generateNext(divisionId, [
                { ...ELIM_SLOTS[0], equipoVisitanteId: 't3' },
                { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2' },
            ])).rejects.toThrow('repite el mismo cruce');
        });
        (0, vitest_1.it)('amistosos automáticos no repiten una pareja de la jornada anterior', async () => {
            mockDivision({ maxEquipos: 4, diasPartido: null });
            mockPlayoffMode();
            mockTeams(['t1', 't2', 't3', 't4']);
            repository_1.jornadaRepository.findByDivision.mockResolvedValue({
                rows: [{
                        numero: 1,
                        partidos: [{ equipoLocalId: 't1', equipoVisitanteId: 't2', tipoPartido: 'AMISTOSO' }],
                    }],
            });
            mockJornadaCreated(2);
            await jornadaService.generateNext(divisionId, [
                { fecha: '2099-01-08', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso' },
            ]);
            const amistoso = repository_2.partidoRepository.create.mock.calls
                .find(([args]) => args.tipoPartido === 'AMISTOSO');
            (0, vitest_1.expect)(amistoso).toBeDefined();
            (0, vitest_1.expect)([amistoso[0].equipoLocalId, amistoso[0].equipoVisitanteId].sort().join('-')).not.toBe('t1-t2');
        });
        (0, vitest_1.it)('rechaza un amistoso manual repetido mientras quedan parejas nuevas', async () => {
            mockDivision({ maxEquipos: 4, diasPartido: null });
            mockPlayoffMode();
            mockTeams(['t1', 't2', 't3', 't4']);
            repository_1.jornadaRepository.findByDivision.mockResolvedValue({
                rows: [{
                        numero: 1,
                        partidos: [{ equipoLocalId: 't1', equipoVisitanteId: 't2', tipoPartido: 'AMISTOSO' }],
                    }],
            });
            mockJornadaCreated(2);
            await (0, vitest_1.expect)(jornadaService.generateNext(divisionId, [
                { fecha: '2099-01-08', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso', equipoLocalId: 't1', equipoVisitanteId: 't2' },
            ])).rejects.toThrow('todavía hay parejas disponibles');
        });
        (0, vitest_1.it)('inicia un nuevo ciclo amistoso después de agotar todas las parejas', async () => {
            mockDivision({ maxEquipos: 4, diasPartido: null });
            mockPlayoffMode();
            mockTeams(['t1', 't2', 't3', 't4']);
            const allPairs = [
                ['t1', 't2'], ['t1', 't3'], ['t1', 't4'],
                ['t2', 't3'], ['t2', 't4'], ['t3', 't4'],
            ];
            repository_1.jornadaRepository.findByDivision.mockResolvedValue({
                rows: [{
                        numero: 6,
                        partidos: allPairs.map(([equipoLocalId, equipoVisitanteId]) => ({ equipoLocalId, equipoVisitanteId, tipoPartido: 'AMISTOSO' })),
                    }],
            });
            mockJornadaCreated(7);
            await jornadaService.generateNext(divisionId, [
                { fecha: '2099-02-01', horaInicio: '18:00', horaFin: '19:00', tipo: 'amistoso' },
            ]);
            const amistosos = repository_2.partidoRepository.create.mock.calls
                .filter(([args]) => args.tipoPartido === 'AMISTOSO');
            (0, vitest_1.expect)(amistosos).toHaveLength(1);
        });
        (0, vitest_1.it)('propaga un fallo transaccional sin compensaciones ni notificación', async () => {
            mockDivision({ maxEquipos: 10, diasPartido: null });
            mockPlayoffMode();
            mockTenTeams();
            mockNoPreviousJornadas();
            mockJornadaCreated();
            repository_2.partidoRepository.findById.mockImplementation((id) => {
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
            database_1.prisma.$transaction.mockRejectedValueOnce(new Error('falló transaction'));
            await (0, vitest_1.expect)(jornadaService.generateNext(divisionId, [
                ...ELIM_SLOTS,
                { fecha: '2099-01-01', horaInicio: '21:00', horaFin: '22:30', tipo: 'amistoso' },
            ])).rejects.toThrow('falló transaction');
            (0, vitest_1.expect)(database_1.prisma.$transaction).toHaveBeenCalledOnce();
            (0, vitest_1.expect)(database_1.prisma.partido.deleteMany).not.toHaveBeenCalled();
            (0, vitest_1.expect)(repository_1.jornadaRepository.delete).not.toHaveBeenCalled();
            (0, vitest_1.expect)(service_2.notificationService.notifyJornadaGenerated).not.toHaveBeenCalled();
        });
    });
});
//# sourceMappingURL=generateNext.test.js.map