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
const leagueScheduleLock_1 = require("../../utils/leagueScheduleLock");
const resultWriter_1 = require("../partido/resultWriter");
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
            fechaFin: partido.fechaFin,
            horaInicio: partido.fecha,
            equipoLocal: partido.equipoLocal,
            equipoVisitante: partido.equipoVisitante,
            cancha: partido.cancha,
            canchaId: partido.canchaId,
            multiplesCanchas: division?.liga.multiplesCanchas ?? false,
            estado: partido.estado,
            version: partido.version,
            golesLocal: partido.golesLocal,
            golesVisitante: partido.golesVisitante,
            penalesLocal: partido.penalesLocal,
            penalesVisitante: partido.penalesVisitante,
            tipoPartido: partido.tipoPartido,
            anotaciones: partido.anotaciones.map(repository_2.exposeAnotacionRead),
            jugadoresLocal: (division?.jugadores ?? [])
                .filter((row) => row.equipoId === partido.equipoLocal?.id)
                .map((row) => ({ ...row.jugador, dorsal: row.dorsal })) ?? [],
            jugadoresVisitante: (division?.jugadores ?? [])
                .filter((row) => row.equipoId === partido.equipoVisitante?.id)
                .map((row) => ({ ...row.jugador, dorsal: row.dorsal })) ?? [],
            jornadaNumero: jornada?.numero ?? null,
            divisionNombre: division?.nombre ?? '',
            ligaNombre: division?.liga.nombre ?? '',
        };
    },
    async updateResultByToken(authHeader, data) {
        const token = extractBearer(authHeader);
        const tokenHash = hashToken(token);
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                return await database_1.prisma.$transaction(async (tx) => {
                    const access = await tx.partidoRefereeAccess.findUnique({ where: { tokenHash } });
                    if (!access || access.usedAt || access.expiresAt < new Date())
                        throw new errors_1.ValidationError('Enlace no válido o expirado');
                    const initial = await (0, resultWriter_1.getResultContext)(tx, access.partidoId);
                    await (0, leagueScheduleLock_1.acquireLeagueScheduleLock)(tx, initial.division.liga.id);
                    const lockedAccess = await tx.partidoRefereeAccess.findUnique({ where: { tokenHash } });
                    if (!lockedAccess || lockedAccess.usedAt || lockedAccess.expiresAt < new Date()) {
                        throw new errors_1.ValidationError('Enlace no válido o expirado');
                    }
                    const locked = await (0, resultWriter_1.getResultContext)(tx, lockedAccess.partidoId);
                    if (locked.division.liga.id !== initial.division.liga.id) {
                        throw new errors_1.ValidationError('El partido cambió durante la actualización; vuelve a intentarlo');
                    }
                    const updated = await (0, resultWriter_1.writeResultInTransaction)(tx, lockedAccess.partidoId, data);
                    await tx.partidoRefereeAccess.update({ where: { id: lockedAccess.id }, data: { usedAt: new Date() } });
                    return updated;
                }, { isolationLevel: 'Serializable' });
            }
            catch (error) {
                if (error?.code === 'P2034' && attempt < 2)
                    continue;
                if (error?.code === 'P2034')
                    throw new errors_1.ConflictError('El resultado cambió durante la actualización; vuelve a intentarlo');
                throw error;
            }
        }
        throw new errors_1.ConflictError('El resultado cambió durante la actualización; vuelve a intentarlo');
    },
};
//# sourceMappingURL=service.js.map