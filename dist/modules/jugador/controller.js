"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jugadorController = void 0;
const database_1 = require("../../config/database");
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
const authorization_1 = require("../../utils/authorization");
const validator_1 = require("./validator");
const service_1 = require("../media/service");
const divisionVisibility_1 = require("../../utils/divisionVisibility");
function sanitizePublic(jugador) {
    return {
        ...jugador,
        telefono: jugador.showPhoneInPublicProfile ? jugador.telefono : null,
        userId: undefined,
        fotoPublicId: undefined,
    };
}
async function assertTeamOwner(equipoId, req) {
    const equipo = await database_1.prisma.equipo.findUnique({ where: { id: equipoId }, select: { userId: true } });
    if (!equipo)
        throw new errors_1.NotFoundError('Equipo');
    (0, authorization_1.assertOwnerOrAdmin)(req.user, equipo.userId, 'Equipo');
}
async function assertTeamInDivision(divisionId, equipoId) {
    const membership = await database_1.prisma.divisionEquipo.findUnique({
        where: { divisionId_equipoId: { divisionId, equipoId } },
    });
    if (!membership)
        throw new errors_1.NotFoundError('Equipo');
}
const jugadorInclude = {
    equipos: {
        include: { equipo: { select: { id: true, nombre: true, logo: true } } },
    },
};
exports.jugadorController = {
    async list(req, res, next) {
        try {
            const { equipoId, search } = req.query;
            const where = {};
            if (equipoId)
                where.equipos = { some: { equipoId: equipoId } };
            if (search)
                where.nombre = { contains: search, mode: 'insensitive' };
            const jugadores = await database_1.prisma.jugador.findMany({
                where,
                orderBy: { nombre: 'asc' },
                include: jugadorInclude,
            });
            (0, response_1.ok)(res, jugadores.map(sanitizePublic));
        }
        catch (e) {
            next(e);
        }
    },
    async getById(req, res, next) {
        try {
            const jugador = await database_1.prisma.jugador.findUnique({
                where: { id: req.params.id },
                include: jugadorInclude,
            });
            if (!jugador)
                throw new errors_1.ValidationError('Jugador no encontrado');
            (0, response_1.ok)(res, sanitizePublic(jugador));
        }
        catch (e) {
            next(e);
        }
    },
    async create(req, res, next) {
        try {
            const p = validator_1.createJugadorSchema.safeParse(req.body);
            if (!p.success)
                throw new errors_1.ValidationError(p.error.issues[0].message);
            const { equipoId, dorsal, ...jugadorData } = p.data;
            await assertTeamOwner(equipoId, req);
            const jugador = await database_1.prisma.$transaction(async (tx) => {
                const existing = await tx.jugador.findUnique({ where: { telefono: jugadorData.telefono } });
                if (existing) {
                    await tx.equipoJugador.create({ data: { equipoId, jugadorId: existing.id, dorsal } });
                    return tx.jugador.findUniqueOrThrow({ where: { id: existing.id }, include: jugadorInclude });
                }
                return tx.jugador.create({
                    data: {
                        ...jugadorData,
                        equipos: { create: { equipoId, dorsal } },
                    },
                    include: jugadorInclude,
                });
            });
            (0, response_1.created)(res, jugador, 'Jugador creado exitosamente');
        }
        catch (e) {
            if (e?.code === 'P2002')
                next(new errors_1.ConflictError('Ese jugador ya está en este equipo o el dorsal ya está usado'));
            else
                next(e);
        }
    },
    async update(req, res, next) {
        try {
            const p = validator_1.updateJugadorSchema.safeParse(req.body);
            if (!p.success)
                throw new errors_1.ValidationError(p.error.issues[0].message);
            const { equipoId, dorsal, ...jugadorData } = p.data;
            if (!(0, authorization_1.isAdmin)(req.user)) {
                if (!equipoId || dorsal == null || Object.keys(jugadorData).length > 0) {
                    throw new errors_1.ForbiddenError('Los dueños de equipo solo pueden actualizar el dorsal');
                }
                await assertTeamOwner(equipoId, req);
            }
            else if (equipoId) {
                await assertTeamOwner(equipoId, req);
            }
            if (jugadorData.foto !== undefined) {
                const old = await database_1.prisma.jugador.findUnique({ where: { id: req.params.id }, select: { foto: true, fotoPublicId: true } });
                if (old && jugadorData.foto !== old.foto) {
                    await service_1.mediaService.scheduleImageCleanup(old.foto, old.fotoPublicId);
                }
            }
            const jugador = await database_1.prisma.$transaction(async (tx) => {
                if (dorsal != null && equipoId) {
                    await tx.equipoJugador.update({
                        where: { equipoId_jugadorId: { equipoId, jugadorId: req.params.id } },
                        data: { dorsal },
                    });
                }
                return Object.keys(jugadorData).length > 0
                    ? tx.jugador.update({ where: { id: req.params.id }, data: jugadorData, include: jugadorInclude })
                    : tx.jugador.findUniqueOrThrow({ where: { id: req.params.id }, include: jugadorInclude });
            });
            (0, response_1.ok)(res, jugador, 'Jugador actualizado exitosamente');
        }
        catch (e) {
            if (e?.code === 'P2002')
                next(new errors_1.ConflictError('Ese dorsal ya está usado en este equipo'));
            else
                next(e);
        }
    },
    async delete(req, res, next) {
        try {
            const jugador = await database_1.prisma.jugador.findUnique({ where: { id: req.params.id }, select: { userId: true, foto: true, fotoPublicId: true } });
            if (!jugador)
                throw new errors_1.NotFoundError('Jugador');
            if (!(0, authorization_1.isAdmin)(req.user) && jugador.userId !== req.user.id)
                throw new errors_1.NotFoundError('Jugador');
            if (jugador)
                await service_1.mediaService.scheduleImageCleanup(jugador.foto, jugador.fotoPublicId);
            await database_1.prisma.jugador.delete({ where: { id: req.params.id } });
            (0, response_1.noContent)(res);
        }
        catch (e) {
            next(e);
        }
    },
    async assignToTeam(req, res, next) {
        try {
            const p = validator_1.assignJugadorSchema.safeParse(req.body);
            if (!p.success)
                throw new errors_1.ValidationError(p.error.issues[0].message);
            await assertTeamOwner(p.data.equipoId, req);
            const result = await database_1.prisma.equipoJugador.create({ data: p.data });
            (0, response_1.created)(res, result, 'Jugador asignado al equipo');
        }
        catch (e) {
            if (e?.code === 'P2002')
                next(new errors_1.ConflictError('Ese jugador o dorsal ya está asignado en este equipo'));
            else
                next(e);
        }
    },
    async removeFromTeam(req, res, next) {
        try {
            await assertTeamOwner(req.params.equipoId, req);
            await database_1.prisma.equipoJugador.delete({
                where: { equipoId_jugadorId: { equipoId: req.params.equipoId, jugadorId: req.params.jugadorId } },
            });
            (0, response_1.noContent)(res);
        }
        catch (e) {
            next(e);
        }
    },
    async listDivisionsByPlayer(req, res, next) {
        try {
            const data = await database_1.prisma.divisionJugador.findMany({
                where: { jugadorId: req.params.jugadorId, division: (0, divisionVisibility_1.visibleDivisionWhere)(req.user) },
                include: {
                    division: {
                        include: {
                            liga: { select: { id: true, nombre: true, logo: true } },
                            estadoLiga: { select: { id: true, nombre: true } },
                        },
                    },
                    equipo: { select: { id: true, nombre: true, logo: true } },
                },
                orderBy: { createdAt: 'desc' },
            });
            (0, response_1.ok)(res, data);
        }
        catch (e) {
            next(e);
        }
    },
    async listByDivisionTeam(req, res, next) {
        try {
            const division = await database_1.prisma.division.findFirst({
                where: { id: req.params.divisionId, ...(0, divisionVisibility_1.visibleDivisionWhere)(req.user) },
                select: {
                    jugadores: {
                        where: { equipoId: req.params.equipoId },
                        include: { jugador: true },
                        orderBy: { jugador: { nombre: 'asc' } },
                    },
                },
            });
            if (!division)
                throw new errors_1.NotFoundError('División');
            (0, response_1.ok)(res, division.jugadores.map((entry) => ({ ...entry, jugador: sanitizePublic(entry.jugador) })));
        }
        catch (e) {
            next(e);
        }
    },
    async assignToDivision(req, res, next) {
        try {
            const p = validator_1.divisionJugadorSchema.safeParse(req.body);
            if (!p.success)
                throw new errors_1.ValidationError(p.error.issues[0].message);
            await assertTeamOwner(p.data.equipoId, req);
            await assertTeamInDivision(p.data.divisionId, p.data.equipoId);
            const result = await database_1.prisma.divisionJugador.create({ data: p.data, include: { jugador: true } });
            (0, response_1.created)(res, { ...result, jugador: sanitizePublic(result.jugador) }, 'Jugador habilitado en división');
        }
        catch (e) {
            if (e?.code === 'P2002')
                next(new errors_1.ConflictError('Ese jugador ya está habilitado en esta división'));
            else if (e?.code === 'P2003')
                next(new errors_1.ValidationError('El jugador debe pertenecer al equipo y el equipo a la división'));
            else
                next(e);
        }
    },
    async removeFromDivision(req, res, next) {
        try {
            await assertTeamOwner(req.params.equipoId, req);
            await assertTeamInDivision(req.params.divisionId, req.params.equipoId);
            await database_1.prisma.divisionJugador.delete({
                where: { divisionId_equipoId_jugadorId: { divisionId: req.params.divisionId, equipoId: req.params.equipoId, jugadorId: req.params.jugadorId } },
            });
            (0, response_1.noContent)(res);
        }
        catch (e) {
            next(e);
        }
    },
    async getMe(req, res, next) {
        try {
            const jugador = await database_1.prisma.jugador.findUnique({
                where: { userId: req.user.id },
                include: jugadorInclude,
            });
            if (!jugador)
                return (0, response_1.ok)(res, null);
            (0, response_1.ok)(res, jugador);
        }
        catch (e) {
            next(e);
        }
    },
    async createMe(req, res, next) {
        try {
            const user = await database_1.prisma.user.findUnique({ where: { id: req.user.id } });
            if (!user)
                throw new errors_1.ValidationError('Usuario no encontrado');
            if (!user.phoneNumber || !user.phoneNumberVerified)
                throw new errors_1.ValidationError('Debes tener un teléfono verificado para crear un perfil de jugador');
            const existing = await database_1.prisma.jugador.findUnique({ where: { userId: user.id } });
            if (existing)
                return (0, response_1.ok)(res, existing);
            const p = validator_1.createMeSchema.safeParse(req.body);
            if (!p.success)
                throw new errors_1.ValidationError(p.error.issues[0].message);
            const byPhone = await database_1.prisma.jugador.findUnique({ where: { telefono: user.phoneNumber } });
            if (byPhone) {
                if (byPhone.userId)
                    throw new errors_1.ConflictError('Este perfil ya está vinculado a otra cuenta');
                const linked = await database_1.prisma.jugador.update({
                    where: { id: byPhone.id },
                    data: { userId: user.id },
                    include: jugadorInclude,
                });
                return (0, response_1.ok)(res, linked, 'Perfil de jugador vinculado');
            }
            const jugador = await database_1.prisma.jugador.create({
                data: { ...p.data, telefono: user.phoneNumber, userId: user.id },
                include: jugadorInclude,
            });
            (0, response_1.created)(res, jugador, 'Perfil de jugador creado');
        }
        catch (e) {
            if (e?.code === 'P2002')
                next(new errors_1.ConflictError('Ya existe un perfil de jugador para esta cuenta'));
            else
                next(e);
        }
    },
    async updateMe(req, res, next) {
        try {
            const jugador = await database_1.prisma.jugador.findUnique({ where: { userId: req.user.id } });
            if (!jugador)
                throw new errors_1.ValidationError('No tienes un perfil de jugador');
            const p = validator_1.updateMeSchema.safeParse(req.body);
            if (!p.success)
                throw new errors_1.ValidationError(p.error.issues[0].message);
            if (p.data.foto !== undefined && p.data.foto !== jugador.foto) {
                await service_1.mediaService.scheduleImageCleanup(jugador.foto, jugador.fotoPublicId);
            }
            const updated = await database_1.prisma.jugador.update({
                where: { id: jugador.id },
                data: p.data,
                include: jugadorInclude,
            });
            (0, response_1.ok)(res, updated, 'Perfil actualizado');
        }
        catch (e) {
            next(e);
        }
    },
};
//# sourceMappingURL=controller.js.map