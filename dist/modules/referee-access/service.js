"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refereeAccessService = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const database_1 = require("../../config/database");
const errors_1 = require("../../utils/errors");
const authorization_1 = require("../../utils/authorization");
const repository_1 = require("./repository");
const repository_2 = require("../partido/repository");
const service_1 = require("../tabla-posicion/service");
const service_2 = require("../ronda-playoff/service");
const LINK_EXPIRY_MS = 4 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;
function hashToken(token) {
    return node_crypto_1.default.createHash('sha256').update(token).digest('hex');
}
function generateToken() {
    return node_crypto_1.default.randomBytes(TOKEN_BYTES).toString('base64url');
}
function isValidTokenFormat(token) {
    return /^[A-Za-z0-9\-_]{43}$/.test(token);
}
function extractBearer(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new errors_1.ValidationError('Token de acceso no válido');
    }
    const token = authHeader.slice(7);
    if (!isValidTokenFormat(token)) {
        throw new errors_1.ValidationError('Token de acceso no válido');
    }
    return token;
}
exports.refereeAccessService = {
    async createAccess(partidoId, actor) {
        const partido = await repository_2.partidoRepository.findAuthorizationContext(partidoId);
        if (!partido)
            throw new errors_1.NotFoundError('Partido');
        (0, authorization_1.assertOwnerOrAdmin)(actor, partido.ligaUserId, 'Partido');
        const token = generateToken();
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + LINK_EXPIRY_MS);
        await repository_1.refereeAccessRepository.upsert({ tokenHash, partidoId, createdById: actor.id, expiresAt });
        const url = `https://tenka.studio/arbitro#token=${token}`;
        return { token, url, expiresAt };
    },
    async revokeAccess(partidoId, actor) {
        const partido = await repository_2.partidoRepository.findAuthorizationContext(partidoId);
        if (!partido)
            throw new errors_1.NotFoundError('Partido');
        (0, authorization_1.assertOwnerOrAdmin)(actor, partido.ligaUserId, 'Partido');
        const existing = await repository_1.refereeAccessRepository.findByPartidoId(partidoId);
        if (existing) {
            await repository_1.refereeAccessRepository.delete(existing.id);
        }
    },
    async getLinkStatus(partidoId, actor) {
        const partido = await repository_2.partidoRepository.findAuthorizationContext(partidoId);
        if (!partido)
            throw new errors_1.NotFoundError('Partido');
        (0, authorization_1.assertOwnerOrAdmin)(actor, partido.ligaUserId, 'Partido');
        const access = await repository_1.refereeAccessRepository.findByPartidoId(partidoId);
        if (!access || access.usedAt || access.expiresAt < new Date()) {
            return { exists: false, expiresAt: null };
        }
        return { exists: true, expiresAt: access.expiresAt };
    },
    async getPartidoByToken(authHeader) {
        const token = extractBearer(authHeader);
        const access = await repository_1.refereeAccessRepository.findPartidoReadContextByTokenHash(hashToken(token));
        if (!access)
            throw new errors_1.ValidationError('Enlace no válido o expirado');
        if (access.usedAt)
            throw new errors_1.ValidationError('Enlace no válido o expirado');
        if (access.expiresAt < new Date())
            throw new errors_1.ValidationError('Enlace no válido o expirado');
        const partido = access.partido;
        if (!partido)
            throw new errors_1.NotFoundError('Partido');
        const jornada = partido.jornada;
        const ronda = partido.rondaPlayoff;
        const division = jornada?.division ?? ronda?.division;
        return {
            id: partido.id,
            fecha: partido.fecha,
            horaInicio: partido.fecha,
            equipoLocal: partido.equipoLocal,
            equipoVisitante: partido.equipoVisitante,
            cancha: partido.cancha,
            estado: partido.estado,
            golesLocal: partido.golesLocal,
            golesVisitante: partido.golesVisitante,
            penalesLocal: partido.penalesLocal,
            penalesVisitante: partido.penalesVisitante,
            tipoPartido: partido.tipoPartido,
            jornadaNumero: jornada?.numero ?? null,
            divisionNombre: division?.nombre ?? '',
            ligaNombre: division?.liga.nombre ?? '',
        };
    },
    async updateResultByToken(authHeader, data) {
        const token = extractBearer(authHeader);
        const tokenHash = hashToken(token);
        return database_1.prisma.$transaction(async (tx) => {
            const access = await tx.partidoRefereeAccess.findUnique({ where: { tokenHash } });
            if (!access)
                throw new errors_1.ValidationError('Enlace no válido o expirado');
            if (access.usedAt)
                throw new errors_1.ValidationError('Enlace no válido o expirado');
            if (access.expiresAt < new Date())
                throw new errors_1.ValidationError('Enlace no válido o expirado');
            const old = await tx.partido.findUnique({
                where: { id: access.partidoId },
                select: { estado: true, rondaPlayoffId: true, jornadaId: true },
            });
            if (!old)
                throw new errors_1.NotFoundError('Partido');
            if (old.estado === 'FINALIZADO')
                throw new errors_1.ValidationError('Este partido ya fue finalizado');
            if (old.rondaPlayoffId) {
                if (data.golesLocal === data.golesVisitante) {
                    if (data.penalesLocal == null || data.penalesVisitante == null || data.penalesLocal === data.penalesVisitante) {
                        throw new errors_1.ValidationError('El partido de eliminatoria no puede terminar empatado. Define un ganador por penales.');
                    }
                }
            }
            const updated = await tx.partido.update({
                where: { id: access.partidoId },
                data: {
                    golesLocal: data.golesLocal,
                    golesVisitante: data.golesVisitante,
                    penalesLocal: data.penalesLocal ?? null,
                    penalesVisitante: data.penalesVisitante ?? null,
                    estado: data.estado,
                },
            });
            await tx.partidoRefereeAccess.update({ where: { id: access.id }, data: { usedAt: new Date() } });
            return {
                id: updated.id,
                golesLocal: updated.golesLocal,
                golesVisitante: updated.golesVisitante,
                penalesLocal: updated.penalesLocal,
                penalesVisitante: updated.penalesVisitante,
                estado: updated.estado,
                jornadaId: old.jornadaId,
                rondaPlayoffId: old.rondaPlayoffId,
            };
        }).then(async (result) => {
            if (result.estado === 'FINALIZADO' && result.jornadaId) {
                const jornada = await database_1.prisma.jornada.findUnique({ where: { id: result.jornadaId }, select: { divisionId: true } });
                if (jornada) {
                    await service_1.tablaPosicionService.recalcular(jornada.divisionId);
                }
            }
            if (result.estado === 'FINALIZADO' && result.rondaPlayoffId) {
                await service_2.rondaPlayoffService.advanceWinners(result.rondaPlayoffId);
            }
            return {
                id: result.id,
                golesLocal: result.golesLocal,
                golesVisitante: result.golesVisitante,
                penalesLocal: result.penalesLocal,
                penalesVisitante: result.penalesVisitante,
                estado: result.estado,
            };
        });
    },
};
//# sourceMappingURL=service.js.map