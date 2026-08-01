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
                        fecha: true,
                        estado: true,
                        golesLocal: true,
                        golesVisitante: true,
                        penalesLocal: true,
                        penalesVisitante: true,
                        tipoPartido: true,
                        equipoLocal: { select: { id: true, nombre: true, logo: true } },
                        equipoVisitante: { select: { id: true, nombre: true, logo: true } },
                        cancha: { select: { id: true, nombre: true } },
                        jornada: {
                            select: {
                                numero: true,
                                division: { select: { nombre: true, liga: { select: { nombre: true } } } },
                            },
                        },
                        rondaPlayoff: {
                            select: {
                                division: { select: { nombre: true, liga: { select: { nombre: true } } } },
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