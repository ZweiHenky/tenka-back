"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEAMS = exports.jornadaService = exports.owner = exports.divisionId = exports.logger = exports.partidoRepository = exports.jornadaRepository = exports.prisma = void 0;
exports.mockDivision = mockDivision;
exports.mockTeams = mockTeams;
exports.mockNoPreviousJornadas = mockNoPreviousJornadas;
exports.mockJornadaCreated = mockJornadaCreated;
exports.mockPartidosCreatedReturn = mockPartidosCreatedReturn;
exports.expectMatch = expectMatch;
exports.resetGenerateNextHarness = resetGenerateNextHarness;
const vitest_1 = require("vitest");
const service_1 = require("../../service");
vitest_1.vi.mock('../../../../config/database', () => ({
    prisma: {
        division: { findUnique: vitest_1.vi.fn() },
        divisionEquipo: { findMany: vitest_1.vi.fn() },
        partido: { findMany: vitest_1.vi.fn(), deleteMany: vitest_1.vi.fn(), createMany: vitest_1.vi.fn(), update: vitest_1.vi.fn(), updateMany: vitest_1.vi.fn() },
        jornada: { findUnique: vitest_1.vi.fn(), findFirst: vitest_1.vi.fn(), create: vitest_1.vi.fn() },
        notificationOutbox: { createMany: vitest_1.vi.fn() },
        rondaPlayoff: { findMany: vitest_1.vi.fn(), findFirst: vitest_1.vi.fn() },
        ligaCancha: { findMany: vitest_1.vi.fn() },
        $executeRawUnsafe: vitest_1.vi.fn(),
        $transaction: vitest_1.vi.fn(),
    },
}));
vitest_1.vi.mock('../../repository', () => ({
    jornadaRepository: {
        findByDivision: vitest_1.vi.fn(),
        findGenerationHistory: vitest_1.vi.fn(),
        create: vitest_1.vi.fn(),
        update: vitest_1.vi.fn(),
        delete: vitest_1.vi.fn(),
    },
}));
vitest_1.vi.mock('../../../partido/repository', () => ({
    partidoRepository: { create: vitest_1.vi.fn(), findById: vitest_1.vi.fn(), update: vitest_1.vi.fn() },
}));
vitest_1.vi.mock('../../../tabla-posicion/service', () => ({
    tablaPosicionService: { recalcular: vitest_1.vi.fn() },
}));
vitest_1.vi.mock('../../../../config/logger', () => ({
    logger: { info: vitest_1.vi.fn(), warn: vitest_1.vi.fn() },
}));
const database_1 = require("../../../../config/database");
const repository_1 = require("../../repository");
const repository_2 = require("../../../partido/repository");
const logger_1 = require("../../../../config/logger");
exports.prisma = database_1.prisma;
exports.jornadaRepository = repository_1.jornadaRepository;
exports.partidoRepository = repository_2.partidoRepository;
exports.logger = logger_1.logger;
exports.divisionId = 'div-test-1';
exports.owner = { id: 'user-1', email: 'owner@test.com', rol: 'LIGA' };
function generateNext(_divisionId, slots, generationKey = 'test-generation-key') {
    return service_1.jornadaService.generateNext(exports.divisionId, exports.owner, slots, undefined, undefined, generationKey);
}
function generateNextWithSelection(slots, equipoIds, descansoEquipoId, generationKey = 'test-selection-key') {
    return service_1.jornadaService.generateNext(exports.divisionId, exports.owner, slots, equipoIds, descansoEquipoId, generationKey);
}
exports.jornadaService = { ...service_1.jornadaService, generateNext, generateNextWithSelection };
exports.TEAMS = [
    { id: 't1', nombre: 'Águilas' },
    { id: 't2', nombre: 'Dragones' },
    { id: 't3', nombre: 'Genix' },
    { id: 't4', nombre: 'Mi Equipo' },
    { id: 't5', nombre: 'Leones' },
    { id: 't6', nombre: 'Tiburones' },
    { id: 't7', nombre: 'Panteras' },
];
function mockDivision(opts) {
    exports.prisma.division.findUnique.mockImplementation(async (query) => {
        if (query.select?.liga && !query.select?.diasPartido && !query.select?.ligaId)
            return { liga: { userId: exports.owner.id } };
        return {
            maxEquipos: opts?.maxEquipos ?? 7,
            diasPartido: opts?.diasPartido ?? null,
            duracionPartido: opts && 'duracionPartido' in opts ? opts.duracionPartido : 90,
            ligaId: 'liga-1',
            canchaUnicaId: opts?.canchaUnicaId ?? null,
            liga: { userId: exports.owner.id, multiplesCanchas: opts?.multiplesCanchas ?? false },
        };
    });
}
function mockTeams(ids) {
    const selected = ids ? exports.TEAMS.filter((t) => ids.includes(t.id)) : exports.TEAMS;
    exports.prisma.divisionEquipo.findMany.mockResolvedValue(selected.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })));
}
function mockNoPreviousJornadas() {
    exports.jornadaRepository.findByDivision.mockResolvedValue({ rows: [] });
}
function mockJornadaCreated(numero = 1) {
    const jornada = { id: 'j-new-1', numero, divisionId: exports.divisionId };
    exports.jornadaRepository.create.mockResolvedValue(jornada);
    return jornada;
}
function mockPartidosCreatedReturn(count) {
    void count;
}
function expectMatch(calls, localId, visitaId, tipo) {
    return calls.some(([args]) => args.equipoLocalId === localId
        && args.equipoVisitanteId === visitaId
        && (tipo === undefined || args.tipoPartido === tipo));
}
function resetGenerateNextHarness() {
    vitest_1.vi.resetAllMocks();
    exports.prisma.rondaPlayoff.findMany.mockResolvedValue([]);
    exports.prisma.jornada.findFirst.mockResolvedValue(null);
    exports.prisma.ligaCancha.findMany.mockResolvedValue([]);
    exports.prisma.rondaPlayoff.findFirst.mockImplementation(async () => {
        const rows = await exports.prisma.rondaPlayoff.findMany();
        return rows[0] ?? null;
    });
    exports.jornadaRepository.findGenerationHistory.mockImplementation(async () => {
        const result = await exports.jornadaRepository.findByDivision();
        return (result?.rows ?? []).map((jornada, jornadaIndex) => ({
            ...jornada,
            id: jornada.id ?? `j-history-${jornada.numero ?? jornadaIndex}`,
            fechaInicio: jornada.fechaInicio ?? null,
            partidos: (jornada.partidos ?? []).map((partido, partidoIndex) => ({
                ...partido,
                id: partido.id ?? `p-history-${jornada.numero ?? jornadaIndex}-${partidoIndex}`,
                fecha: partido.fecha ?? null,
            })),
        }));
    });
    exports.prisma.partido.findMany.mockImplementation(async (query) => {
        if (!query?.where?.id?.in)
            return [];
        const rows = await Promise.all(query.where.id.in.map((id) => exports.partidoRepository.findById(id)));
        return rows.filter(Boolean);
    });
    exports.prisma.partido.update.mockImplementation(async ({ where, data }) => exports.partidoRepository.update(where.id, data));
    exports.prisma.partido.updateMany.mockImplementation(async ({ where, data }) => {
        await exports.partidoRepository.update(where.id, data);
        return { count: 1 };
    });
    exports.prisma.partido.createMany.mockImplementation(async ({ data }) => {
        for (const partido of data)
            await exports.partidoRepository.create(partido);
        return { count: data.length };
    });
    exports.prisma.$transaction.mockImplementation(async (callback) => callback({
        $executeRawUnsafe: exports.prisma.$executeRawUnsafe,
        ligaCancha: exports.prisma.ligaCancha,
        division: exports.prisma.division,
        divisionEquipo: exports.prisma.divisionEquipo,
        jornada: {
            findFirst: vitest_1.vi.fn(async (query) => {
                if (query?.where?.generationKey)
                    return exports.prisma.jornada.findFirst(query);
                const result = await exports.jornadaRepository.findByDivision(exports.divisionId);
                const history = result?.rows ?? [];
                return history.length > 0 ? { numero: Math.max(...history.map((item) => item.numero)) } : null;
            }),
            create: vitest_1.vi.fn(async ({ data }) => exports.jornadaRepository.create(data)),
        },
        partido: {
            findMany: exports.prisma.partido.findMany,
            update: exports.prisma.partido.update,
            updateMany: exports.prisma.partido.updateMany,
            createMany: exports.prisma.partido.createMany,
        },
        notificationOutbox: exports.prisma.notificationOutbox,
    }));
}
//# sourceMappingURL=generateNextHarness.js.map