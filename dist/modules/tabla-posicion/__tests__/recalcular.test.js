"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const db = vitest_1.vi.hoisted(() => ({
    transaction: vitest_1.vi.fn(),
    teamsFindMany: vitest_1.vi.fn(),
    matchesFindMany: vitest_1.vi.fn(),
    standingsDeleteMany: vitest_1.vi.fn(),
    standingsCreateMany: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../../config/database', () => ({
    prisma: {
        $transaction: db.transaction,
        divisionEquipo: { findMany: db.teamsFindMany },
        partido: { findMany: db.matchesFindMany },
    },
}));
const database_1 = require("../../../config/database");
const service_1 = require("../service");
const divisionId = 'division-1';
function mockTeams() {
    vitest_1.vi.mocked(database_1.prisma.divisionEquipo.findMany).mockResolvedValue([
        { equipoId: 'local' },
        { equipoId: 'visitante' },
    ]);
}
function mockTiedMatch(penalesLocal, penalesVisitante) {
    vitest_1.vi.mocked(database_1.prisma.partido.findMany).mockResolvedValue([
        {
            equipoLocalId: 'local',
            equipoVisitanteId: 'visitante',
            golesLocal: 2,
            golesVisitante: 2,
            penalesLocal,
            penalesVisitante,
            tipoPartido: 'REGULAR',
        },
    ]);
}
function createdRow(equipoId) {
    const data = db.standingsCreateMany.mock.calls[0]?.[0].data;
    return data.find((row) => row.equipoId === equipoId);
}
(0, vitest_1.describe)('tablaPosicionService.recalcular', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        db.transaction.mockImplementation(async (callback) => callback({
            tablaPosicion: {
                deleteMany: db.standingsDeleteMany,
                createMany: db.standingsCreateMany,
            },
        }));
        mockTeams();
    });
    (0, vitest_1.it)('registra empate para ambos y 2/1 puntos cuando gana el local por penales', async () => {
        mockTiedMatch(5, 4);
        await service_1.tablaPosicionService.recalcular(divisionId);
        (0, vitest_1.expect)(createdRow('local')).toMatchObject({
            partidosJugados: 1,
            ganados: 0,
            empatados: 1,
            perdidos: 0,
            golesFavor: 2,
            golesContra: 2,
            diferenciaGoles: 0,
            puntos: 2,
        });
        (0, vitest_1.expect)(createdRow('visitante')).toMatchObject({
            partidosJugados: 1,
            ganados: 0,
            empatados: 1,
            perdidos: 0,
            golesFavor: 2,
            golesContra: 2,
            diferenciaGoles: 0,
            puntos: 1,
        });
    });
    (0, vitest_1.it)('registra empate para ambos y 2/1 puntos cuando gana el visitante por penales', async () => {
        mockTiedMatch(3, 4);
        await service_1.tablaPosicionService.recalcular(divisionId);
        (0, vitest_1.expect)(createdRow('local')).toMatchObject({
            ganados: 0,
            empatados: 1,
            perdidos: 0,
            puntos: 1,
        });
        (0, vitest_1.expect)(createdRow('visitante')).toMatchObject({
            ganados: 0,
            empatados: 1,
            perdidos: 0,
            puntos: 2,
        });
    });
    (0, vitest_1.it)('no registra estadísticas para ningún equipo en partido amistoso (local gana)', async () => {
        vitest_1.vi.mocked(database_1.prisma.partido.findMany).mockResolvedValue([
            {
                equipoLocalId: 'local',
                equipoVisitanteId: 'visitante',
                golesLocal: 3,
                golesVisitante: 1,
                penalesLocal: null,
                penalesVisitante: null,
                tipoPartido: 'AMISTOSO',
            },
        ]);
        await service_1.tablaPosicionService.recalcular(divisionId);
        (0, vitest_1.expect)(createdRow('local')).toMatchObject({
            partidosJugados: 0, ganados: 0, empatados: 0, perdidos: 0,
            golesFavor: 0, golesContra: 0, diferenciaGoles: 0, puntos: 0,
        });
        (0, vitest_1.expect)(createdRow('visitante')).toMatchObject({
            partidosJugados: 0, ganados: 0, empatados: 0, perdidos: 0,
            golesFavor: 0, golesContra: 0, diferenciaGoles: 0, puntos: 0,
        });
    });
    (0, vitest_1.it)('no registra estadísticas para ningún equipo en partido amistoso (empate con penales)', async () => {
        vitest_1.vi.mocked(database_1.prisma.partido.findMany).mockResolvedValue([
            {
                equipoLocalId: 'local',
                equipoVisitanteId: 'visitante',
                golesLocal: 1,
                golesVisitante: 1,
                penalesLocal: 4,
                penalesVisitante: 3,
                tipoPartido: 'AMISTOSO',
            },
        ]);
        await service_1.tablaPosicionService.recalcular(divisionId);
        (0, vitest_1.expect)(createdRow('local')).toMatchObject({
            partidosJugados: 0, ganados: 0, empatados: 0, perdidos: 0,
            golesFavor: 0, golesContra: 0, diferenciaGoles: 0, puntos: 0,
        });
        (0, vitest_1.expect)(createdRow('visitante')).toMatchObject({
            partidosJugados: 0, ganados: 0, empatados: 0, perdidos: 0,
            golesFavor: 0, golesContra: 0, diferenciaGoles: 0, puntos: 0,
        });
    });
    (0, vitest_1.it)('reemplaza toda la tabla con deleteMany y createMany dentro de una sola transacción', async () => {
        mockTiedMatch(5, 4);
        await service_1.tablaPosicionService.recalcular(divisionId);
        (0, vitest_1.expect)(db.transaction).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(db.standingsDeleteMany).toHaveBeenCalledWith({ where: { divisionId } });
        (0, vitest_1.expect)(db.standingsCreateMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(db.standingsCreateMany.mock.invocationCallOrder[0])
            .toBeGreaterThan(db.standingsDeleteMany.mock.invocationCallOrder[0]);
    });
    (0, vitest_1.it)('mantiene un presupuesto constante de consultas aunque aumente el número de equipos', async () => {
        db.teamsFindMany.mockResolvedValue(Array.from({ length: 100 }, (_, index) => ({ equipoId: `team-${index}` })));
        db.matchesFindMany.mockResolvedValue([]);
        await service_1.tablaPosicionService.recalcular(divisionId);
        (0, vitest_1.expect)(db.teamsFindMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(db.teamsFindMany).toHaveBeenCalledWith({
            where: { divisionId },
            select: { equipoId: true },
        });
        (0, vitest_1.expect)(db.matchesFindMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(db.matchesFindMany).toHaveBeenCalledWith({
            where: {
                jornada: { divisionId },
                estado: 'FINALIZADO',
                rondaPlayoffId: null,
            },
            select: {
                equipoLocalId: true,
                equipoVisitanteId: true,
                golesLocal: true,
                golesVisitante: true,
                penalesLocal: true,
                penalesVisitante: true,
                tipoPartido: true,
            },
        });
        (0, vitest_1.expect)(db.transaction).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(db.standingsDeleteMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(db.standingsCreateMany).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(db.standingsCreateMany).toHaveBeenCalledWith({
            data: vitest_1.expect.arrayContaining([
                vitest_1.expect.objectContaining({ equipoId: 'team-0' }),
                vitest_1.expect.objectContaining({ equipoId: 'team-99' }),
            ]),
        });
        (0, vitest_1.expect)(db.standingsCreateMany.mock.calls[0][0].data).toHaveLength(100);
    });
});
//# sourceMappingURL=recalcular.test.js.map