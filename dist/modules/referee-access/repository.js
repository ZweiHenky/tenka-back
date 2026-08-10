"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refereeAccessRepository = void 0;
const database_1 = require("../../config/database");
exports.refereeAccessRepository = {
    async findByTokenHash(tokenHash) {
        return database_1.prisma.partidoRefereeAccess.findUnique({ where: { tokenHash } });
    },
    async findPartidoReadContextByTokenHash(tokenHash) {
        return database_1.prisma.partidoRefereeAccess.findUnique({
            where: { tokenHash },
            select: {
                expiresAt: true,
                usedAt: true,
                partido: {
                    select: {
                        id: true,
                        version: true,
                        fecha: true,
                        fechaFin: true,
                        canchaId: true,
                        estado: true,
                        golesLocal: true,
                        golesVisitante: true,
                        penalesLocal: true,
                        penalesVisitante: true,
                        tipoPartido: true,
                        notas: true,
                        anotaciones: {
                            select: { id: true, jugadorId: true, equipoId: true, ladoMarcador: true, cantidad: true, jugadorNombre: true, equipoNombre: true, dorsal: true },
                            orderBy: [{ ladoMarcador: 'asc' }, { jugadorNombre: 'asc' }, { id: 'asc' }],
                        },
                        participaciones: {
                            select: { id: true, jugadorId: true, equipoId: true, ladoMarcador: true, jugadorIdSnapshot: true, equipoIdSnapshot: true, jugadorNombre: true, equipoNombre: true, dorsal: true },
                            orderBy: [{ ladoMarcador: 'asc' }, { jugadorNombre: 'asc' }, { id: 'asc' }],
                        },
                        equipoLocal: { select: { id: true, nombre: true, logo: true } },
                        equipoVisitante: { select: { id: true, nombre: true, logo: true } },
                        cancha: { select: { id: true, nombre: true } },
                        jornada: {
                            select: {
                                numero: true,
                                division: { select: {
                                        nombre: true,
                                        registrarParticipaciones: true,
                                        usarPenalesEnEmpates: true,
                                        liga: { select: { nombre: true, multiplesCanchas: true } },
                                        jugadores: { select: { equipoId: true, dorsal: true, jugador: { select: { id: true, nombre: true, foto: true } } } },
                                    } },
                            },
                        },
                        rondaPlayoff: {
                            select: {
                                division: { select: {
                                        nombre: true,
                                        registrarParticipaciones: true,
                                        usarPenalesEnEmpates: true,
                                        liga: { select: { nombre: true, multiplesCanchas: true } },
                                        jugadores: { select: { equipoId: true, dorsal: true, jugador: { select: { id: true, nombre: true, foto: true } } } },
                                    } },
                            },
                        },
                    },
                },
            },
        });
    },
    async findByPartidoId(partidoId) {
        return database_1.prisma.partidoRefereeAccess.findFirst({ where: { partidoId } });
    },
    async upsert(data) {
        return database_1.prisma.partidoRefereeAccess.upsert({
            where: { partidoId: data.partidoId },
            update: { tokenHash: data.tokenHash, createdById: data.createdById, expiresAt: data.expiresAt, usedAt: null },
            create: data,
        });
    },
    async markUsedInTx(tx, id) {
        await tx.partidoRefereeAccess.update({ where: { id }, data: { usedAt: new Date() } });
    },
    async delete(id) {
        await database_1.prisma.partidoRefereeAccess.delete({ where: { id } });
    },
};
//# sourceMappingURL=repository.js.map