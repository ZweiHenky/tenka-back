"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rondaPlayoffService = void 0;
const errors_1 = require("../../utils/errors");
const database_1 = require("../../config/database");
const repository_1 = require("./repository");
const authorization_1 = require("../../utils/authorization");
const divisionVisibility_1 = require("../../utils/divisionVisibility");
async function assertDivisionOwner(divisionId, actor) {
    const division = await database_1.prisma.division.findUnique({
        where: { id: divisionId },
        select: { liga: { select: { userId: true } } },
    });
    if (!division)
        throw new errors_1.NotFoundError('División');
    (0, authorization_1.assertOwnerOrAdmin)(actor, division.liga.userId, 'División');
}
async function findForWrite(id, actor) {
    const ronda = await repository_1.rondaPlayoffRepository.findById(id);
    if (!ronda)
        throw new errors_1.NotFoundError('Ronda de playoff');
    await (0, divisionVisibility_1.assertVisibleDivision)(ronda.divisionId, actor);
    return ronda;
}
function getWinner(p) {
    if (p.golesLocal > p.golesVisitante)
        return p.equipoLocalId;
    if (p.golesVisitante > p.golesLocal)
        return p.equipoVisitanteId;
    if (p.penalesLocal != null && p.penalesVisitante != null) {
        if (p.penalesLocal > p.penalesVisitante)
            return p.equipoLocalId;
        if (p.penalesVisitante > p.penalesLocal)
            return p.equipoVisitanteId;
    }
    return null;
}
const NOMBRES_RONDAS = {
    2: ['Final'],
    4: ['Semifinal', 'Final'],
    8: ['Cuartos', 'Semifinal', 'Final'],
    16: ['Octavos', 'Cuartos', 'Semifinal', 'Final'],
    32: ['Dieciseisavos', 'Octavos', 'Cuartos', 'Semifinal', 'Final'],
};
const CANTIDADES_EQUIPOS = [2, 4, 8, 16, 32];
const spanishNameCollator = new Intl.Collator('es', { sensitivity: 'base' });
exports.rondaPlayoffService = {
    async list(actor) {
        return database_1.prisma.rondaPlayoff.findMany({ where: { division: (0, divisionVisibility_1.visibleDivisionWhere)(actor) } });
    },
    async getById(id, actor) {
        const t = await repository_1.rondaPlayoffRepository.findVisibleById(id, actor);
        if (!t)
            throw new errors_1.NotFoundError('Ronda de playoff');
        return t;
    },
    async findByDivision(divisionId, actor) {
        const rondas = await repository_1.rondaPlayoffRepository.findVisibleByDivision(divisionId, actor);
        if (!rondas)
            throw new errors_1.NotFoundError('División');
        return rondas;
    },
    async create(data, actor) {
        await assertDivisionOwner(data.divisionId, actor);
        return repository_1.rondaPlayoffRepository.create(data);
    },
    async update(id, data, actor) {
        const ronda = await findForWrite(id, actor);
        await assertDivisionOwner(ronda.divisionId, actor);
        return repository_1.rondaPlayoffRepository.update(id, data);
    },
    async delete(id, actor) {
        const ronda = await findForWrite(id, actor);
        await assertDivisionOwner(ronda.divisionId, actor);
        await repository_1.rondaPlayoffRepository.delete(id);
    },
    async deleteByDivision(divisionId, actor) {
        await assertDivisionOwner(divisionId, actor);
        await repository_1.rondaPlayoffRepository.deleteByDivision(divisionId);
    },
    async generate(divisionId, cantidadEquipos, actor) {
        const division = await database_1.prisma.division.findFirst({
            where: (0, authorization_1.isAdmin)(actor) ? { id: divisionId } : { id: divisionId, liga: { userId: actor.id } },
            select: {
                equipos: {
                    select: {
                        equipoId: true,
                        equipo: {
                            select: {
                                nombre: true,
                                tablaPosiciones: {
                                    where: { divisionId },
                                    select: { puntos: true, diferenciaGoles: true, ganados: true, golesFavor: true },
                                },
                            },
                        },
                    },
                },
            },
        });
        if (!division)
            throw new errors_1.NotFoundError('División');
        if (!CANTIDADES_EQUIPOS.includes(cantidadEquipos)) {
            throw new errors_1.ValidationError('La cantidad debe ser 2, 4, 8, 16 o 32');
        }
        if (division.equipos.length < cantidadEquipos) {
            throw new errors_1.ValidationError(`Se necesitan al menos ${cantidadEquipos} equipos asignados a la división`);
        }
        const clasificados = division.equipos
            .map(({ equipoId, equipo }) => ({
            equipoId,
            nombre: equipo.nombre,
            puntos: equipo.tablaPosiciones[0]?.puntos ?? 0,
            diferenciaGoles: equipo.tablaPosiciones[0]?.diferenciaGoles ?? 0,
            ganados: equipo.tablaPosiciones[0]?.ganados ?? 0,
            golesFavor: equipo.tablaPosiciones[0]?.golesFavor ?? 0,
        }))
            .sort((a, b) => b.puntos - a.puntos
            || b.diferenciaGoles - a.diferenciaGoles
            || b.ganados - a.ganados
            || b.golesFavor - a.golesFavor
            || spanishNameCollator.compare(a.nombre, b.nombre)
            || a.equipoId.localeCompare(b.equipoId))
            .slice(0, cantidadEquipos);
        const nombresRonda = NOMBRES_RONDAS[cantidadEquipos];
        return database_1.prisma.$transaction(async (tx) => {
            const rondas = await tx.rondaPlayoff.createManyAndReturn({
                data: nombresRonda.map((nombre, index) => ({
                    nombre,
                    orden: index + 1,
                    divisionId,
                })),
            });
            rondas.sort((a, b) => a.orden - b.orden);
            const primeraRonda = rondas[0];
            await tx.partido.createMany({
                data: Array.from({ length: clasificados.length / 2 }, (_, i) => ({
                    equipoLocalId: clasificados[i].equipoId,
                    equipoVisitanteId: clasificados[clasificados.length - 1 - i].equipoId,
                    llave: i + 1,
                    rondaPlayoffId: primeraRonda.id,
                    estado: 'PROGRAMADO',
                    tipoPartido: 'ELIMINATORIA',
                })),
            });
            return rondas;
        });
    },
    async advanceWinners(fromRondaPlayoffId) {
        await database_1.prisma.$transaction(async (tx) => {
            const currentRound = await tx.rondaPlayoff.findUnique({
                where: { id: fromRondaPlayoffId },
                select: {
                    orden: true,
                    division: { select: { rondasPlayoff: { select: { id: true, orden: true } } } },
                },
            });
            if (!currentRound)
                throw new errors_1.NotFoundError('Ronda de playoff');
            const nextRound = currentRound.division.rondasPlayoff.find((ronda) => ronda.orden === currentRound.orden + 1);
            if (!nextRound)
                return;
            const partidos = await tx.partido.findMany({
                where: { rondaPlayoffId: { in: [fromRondaPlayoffId, nextRound.id] } },
                select: {
                    id: true,
                    rondaPlayoffId: true,
                    llave: true,
                    estado: true,
                    golesLocal: true,
                    golesVisitante: true,
                    penalesLocal: true,
                    penalesVisitante: true,
                    equipoLocalId: true,
                    equipoVisitanteId: true,
                },
            });
            const currentRoundPartidos = partidos.filter((partido) => partido.rondaPlayoffId === fromRondaPlayoffId);
            const currentPartidos = new Map(currentRoundPartidos.map((partido) => [partido.llave, partido]));
            const nextPartidos = new Map(partidos
                .filter((partido) => partido.rondaPlayoffId === nextRound.id)
                .map((partido) => [partido.llave, partido]));
            const pairCount = Math.ceil(currentRoundPartidos.length / 2);
            const creates = [];
            const updates = [];
            for (let i = 1; i <= pairCount; i++) {
                const partidoA = currentPartidos.get(i * 2 - 1);
                const partidoB = currentPartidos.get(i * 2);
                if (!partidoA || !partidoB)
                    continue;
                if (partidoA.estado !== 'FINALIZADO' || partidoB.estado !== 'FINALIZADO')
                    continue;
                const winnerA = getWinner(partidoA);
                const winnerB = getWinner(partidoB);
                if (!winnerA || !winnerB)
                    continue;
                const existing = nextPartidos.get(i);
                if (existing) {
                    updates.push({ id: existing.id, equipoLocalId: winnerA, equipoVisitanteId: winnerB });
                }
                else {
                    creates.push({
                        equipoLocalId: winnerA,
                        equipoVisitanteId: winnerB,
                        llave: i,
                        rondaPlayoffId: nextRound.id,
                        estado: 'PROGRAMADO',
                        tipoPartido: 'ELIMINATORIA',
                    });
                }
            }
            await Promise.all([
                ...(creates.length ? [tx.partido.createMany({ data: creates })] : []),
                ...updates.map(({ id, ...data }) => tx.partido.update({
                    where: { id },
                    data: { ...data, estado: 'PROGRAMADO', golesLocal: 0, golesVisitante: 0, penalesLocal: null, penalesVisitante: null },
                })),
            ]);
        });
    },
};
//# sourceMappingURL=service.js.map