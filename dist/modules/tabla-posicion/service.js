"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tablaPosicionService = void 0;
const errors_1 = require("../../utils/errors");
const database_1 = require("../../config/database");
const repository_1 = require("./repository");
const authorization_1 = require("../../utils/authorization");
async function assertDivisionOwner(divisionId, actor) {
    const division = await database_1.prisma.division.findUnique({
        where: { id: divisionId },
        select: { liga: { select: { userId: true } } },
    });
    if (!division)
        throw new errors_1.NotFoundError('División');
    (0, authorization_1.assertOwnerOrAdmin)(actor, division.liga.userId, 'División');
}
exports.tablaPosicionService = {
    async findByDivision(divisionId, actor) {
        const division = await repository_1.tablaPosicionRepository.findByDivision(divisionId, actor);
        if (!division)
            throw new errors_1.NotFoundError('División');
        if (division.tablaPosiciones.length > 0)
            return division.tablaPosiciones;
        return division.equipos.map((t) => ({
            id: `placeholder-${t.equipoId}`,
            partidosJugados: 0,
            ganados: 0,
            empatados: 0,
            perdidos: 0,
            golesFavor: 0,
            golesContra: 0,
            diferenciaGoles: 0,
            puntos: 0,
            divisionId,
            equipoId: t.equipoId,
            equipo: t.equipo,
        }));
    },
    async recalcular(divisionId, transaction) {
        const recalculate = async (tx) => {
            const [teams, partidos] = await Promise.all([
                tx.divisionEquipo.findMany({
                    where: { divisionId },
                    select: { equipoId: true },
                }),
                tx.partido.findMany({
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
                }),
            ]);
            const stats = new Map();
            for (const equipoId of teams.map((t) => t.equipoId)) {
                stats.set(equipoId, { pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, gp: 0 });
            }
            for (const p of partidos) {
                if (!p.equipoLocalId || !p.equipoVisitanteId)
                    continue;
                const local = stats.get(p.equipoLocalId);
                const visit = stats.get(p.equipoVisitanteId);
                if (!local || !visit)
                    continue;
                if (p.tipoPartido === 'AMISTOSO') {
                    continue;
                }
                if (p.tipoPartido === 'COMPLEMENTO') {
                    local.pj++;
                    local.gf += p.golesLocal;
                    local.gc += p.golesVisitante;
                    if (p.golesLocal > p.golesVisitante)
                        local.g++;
                    else if (p.golesLocal < p.golesVisitante)
                        local.p++;
                    else {
                        local.e++;
                        const tienePenales = p.penalesLocal != null && p.penalesVisitante != null;
                        if (tienePenales && p.penalesLocal > p.penalesVisitante) {
                            local.gp++;
                        }
                    }
                    continue;
                }
                local.pj++;
                visit.pj++;
                local.gf += p.golesLocal;
                local.gc += p.golesVisitante;
                visit.gf += p.golesVisitante;
                visit.gc += p.golesLocal;
                if (p.golesLocal > p.golesVisitante) {
                    local.g++;
                    visit.p++;
                }
                else if (p.golesLocal < p.golesVisitante) {
                    local.p++;
                    visit.g++;
                }
                else {
                    local.e++;
                    visit.e++;
                    const tienePenales = p.penalesLocal != null && p.penalesVisitante != null;
                    if (tienePenales) {
                        if (p.penalesLocal > p.penalesVisitante) {
                            local.gp++;
                        }
                        else {
                            visit.gp++;
                        }
                    }
                }
            }
            const data = [];
            for (const t of teams) {
                const s = stats.get(t.equipoId);
                data.push({
                    divisionId,
                    equipoId: t.equipoId,
                    partidosJugados: s.pj,
                    ganados: s.g,
                    empatados: s.e,
                    perdidos: s.p,
                    golesFavor: s.gf,
                    golesContra: s.gc,
                    diferenciaGoles: s.gf - s.gc,
                    puntos: s.g * 3 + s.e + s.gp,
                });
            }
            data.sort((a, b) => b.puntos - a.puntos || (b.diferenciaGoles - a.diferenciaGoles));
            await tx.tablaPosicion.deleteMany({ where: { divisionId } });
            await tx.tablaPosicion.createMany({ data });
        };
        if (transaction) {
            await recalculate(transaction);
            return;
        }
        await database_1.prisma.$transaction(recalculate, { isolationLevel: 'RepeatableRead' });
    },
    async findOne(divisionId, equipoId, actor) {
        const division = await repository_1.tablaPosicionRepository.findOne(divisionId, equipoId, actor);
        if (!division)
            throw new errors_1.NotFoundError('División');
        const position = division.tablaPosiciones[0];
        if (!position)
            throw new errors_1.NotFoundError('Posición');
        return position;
    },
    async upsert(divisionId, equipoId, data, actor) {
        await assertDivisionOwner(divisionId, actor);
        return repository_1.tablaPosicionRepository.upsert(divisionId, equipoId, data);
    },
    async delete(divisionId, equipoId, actor) {
        await assertDivisionOwner(divisionId, actor);
        await repository_1.tablaPosicionRepository.delete(divisionId, equipoId);
    },
};
//# sourceMappingURL=service.js.map