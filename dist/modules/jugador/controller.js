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
const pagination_1 = require("../../utils/pagination");
const jobSignals_1 = require("../../workers/jobSignals");
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
async function assertCanManageDivisionRoster(divisionId, equipoId, req) {
    const membership = await database_1.prisma.divisionEquipo.findUnique({
        where: { divisionId_equipoId: { divisionId, equipoId } },
        select: {
            division: { select: { liga: { select: { userId: true } } } },
        },
    });
    if (!membership)
        throw new errors_1.NotFoundError('Equipo en división');
    if (!(0, authorization_1.isAdmin)(req.user) && membership.division.liga.userId !== req.user.id) {
        throw new errors_1.NotFoundError('Equipo en división');
    }
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
            if (equipoId) {
                const jugadores = await database_1.prisma.jugador.findMany({ where, orderBy: { nombre: 'asc' }, include: jugadorInclude });
                (0, response_1.ok)(res, jugadores.map(sanitizePublic));
                return;
            }
            const { skip, take } = (0, pagination_1.parsePagination)(req.query);
            const [jugadores, total] = await Promise.all([
                database_1.prisma.jugador.findMany({ where, orderBy: { nombre: 'asc' }, include: jugadorInclude, skip, take }),
                database_1.prisma.jugador.count({ where }),
            ]);
            (0, response_1.ok)(res, { rows: jugadores.map(sanitizePublic), total });
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
            const { equipoId, dorsal, photoAssetId, ...jugadorData } = p.data;
            await assertTeamOwner(equipoId, req);
            const jugador = await database_1.prisma.$transaction(async (tx) => {
                const existing = await tx.jugador.findUnique({ where: { telefono: jugadorData.telefono } });
                if (existing) {
                    await tx.equipoJugador.create({ data: { equipoId, jugadorId: existing.id, dorsal } });
                    await tx.divisionJugador.updateMany({ where: { equipoId, jugadorId: existing.id }, data: { dorsal } });
                    return tx.jugador.findUniqueOrThrow({ where: { id: existing.id }, include: jugadorInclude });
                }
                const media = await service_1.mediaService.prepareAttachment(tx, photoAssetId, req.user.id, 'PLAYER_PHOTO');
                return tx.jugador.create({
                    data: {
                        ...jugadorData,
                        ...(media && { foto: media.url, fotoPublicId: media.publicId }),
                        equipos: { create: { equipoId, dorsal } },
                    },
                    include: jugadorInclude,
                });
            });
            (0, jobSignals_1.signalBackgroundJob)('media-deletion');
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
            const { equipoId, dorsal, photoAssetId, ...jugadorData } = p.data;
            if (!(0, authorization_1.isAdmin)(req.user)) {
                if (!equipoId || dorsal == null || Object.keys(jugadorData).length > 0 || photoAssetId !== undefined) {
                    throw new errors_1.ForbiddenError('Los dueños de equipo solo pueden actualizar el dorsal');
                }
                await assertTeamOwner(equipoId, req);
            }
            else if (equipoId) {
                await assertTeamOwner(equipoId, req);
            }
            const jugador = await database_1.prisma.$transaction(async (tx) => {
                await service_1.mediaService.lockAttachmentTarget(tx, 'jugador', req.params.id);
                const old = await tx.jugador.findUniqueOrThrow({ where: { id: req.params.id }, select: { foto: true, fotoPublicId: true } });
                const media = await service_1.mediaService.prepareAttachment(tx, photoAssetId, req.user.id, 'PLAYER_PHOTO', old.foto, old.fotoPublicId);
                if (dorsal != null && equipoId) {
                    const membership = await tx.equipoJugador.findUnique({
                        where: { equipoId_jugadorId: { equipoId, jugadorId: req.params.id } },
                        select: { jugadorId: true },
                    });
                    if (!membership)
                        throw new errors_1.NotFoundError('Jugador en este equipo');
                    await tx.equipoJugador.update({
                        where: { equipoId_jugadorId: { equipoId, jugadorId: req.params.id } },
                        data: { dorsal },
                    });
                    await tx.divisionJugador.updateMany({ where: { equipoId, jugadorId: req.params.id }, data: { dorsal } });
                }
                return Object.keys(jugadorData).length > 0 || media
                    ? tx.jugador.update({ where: { id: req.params.id }, data: { ...jugadorData, ...(media && { foto: media.url, fotoPublicId: media.publicId }) }, include: jugadorInclude })
                    : tx.jugador.findUniqueOrThrow({ where: { id: req.params.id }, include: jugadorInclude });
            });
            (0, jobSignals_1.signalBackgroundJob)('media-deletion');
            (0, response_1.ok)(res, jugador, 'Jugador actualizado exitosamente');
        }
        catch (e) {
            if (e?.code === 'P2002')
                next(new errors_1.ConflictError('Ese dorsal ya está usado en este equipo'));
            else if (e?.code === 'P2025')
                next(new errors_1.NotFoundError('Jugador'));
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
            await database_1.prisma.$transaction(async (tx) => {
                await service_1.mediaService.scheduleImageCleanup(jugador.foto, jugador.fotoPublicId, tx);
                await tx.jugador.delete({ where: { id: req.params.id } });
            });
            (0, jobSignals_1.signalBackgroundJob)('media-deletion');
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
            const result = await database_1.prisma.$transaction(async (tx) => {
                const jugador = await tx.jugador.findUnique({ where: { id: p.data.jugadorId }, select: { id: true } });
                if (!jugador)
                    throw new errors_1.NotFoundError('Jugador');
                const membership = await tx.equipoJugador.findUnique({
                    where: { equipoId_jugadorId: { equipoId: p.data.equipoId, jugadorId: p.data.jugadorId } },
                    select: { equipoId: true, jugadorId: true, dorsal: true },
                });
                if (membership) {
                    if (membership.dorsal !== p.data.dorsal)
                        throw new errors_1.ConflictError('El jugador ya pertenece a este equipo');
                    return { membership, alreadyAssigned: true };
                }
                const occupiedDorsal = await tx.equipoJugador.findUnique({
                    where: { equipoId_dorsal: { equipoId: p.data.equipoId, dorsal: p.data.dorsal } },
                    select: { jugadorId: true },
                });
                if (occupiedDorsal)
                    throw new errors_1.ConflictError('El dorsal ya está ocupado en este equipo');
                const createdMembership = await tx.equipoJugador.create({ data: p.data });
                await tx.divisionJugador.updateMany({
                    where: { equipoId: p.data.equipoId, jugadorId: p.data.jugadorId },
                    data: { dorsal: p.data.dorsal },
                });
                return { membership: createdMembership, alreadyAssigned: false };
            });
            if (result.alreadyAssigned)
                (0, response_1.ok)(res, result.membership, 'Jugador ya asignado al equipo');
            else
                (0, response_1.created)(res, result.membership, 'Jugador asignado al equipo');
        }
        catch (e) {
            if (e?.code === 'P2002') {
                const data = validator_1.assignJugadorSchema.safeParse(req.body);
                if (!data.success)
                    return next(e);
                const membership = await database_1.prisma.equipoJugador.findUnique({
                    where: { equipoId_jugadorId: { equipoId: data.data.equipoId, jugadorId: data.data.jugadorId } },
                    select: { equipoId: true, jugadorId: true, dorsal: true },
                });
                if (membership?.dorsal === data.data.dorsal)
                    return (0, response_1.ok)(res, membership, 'Jugador ya asignado al equipo');
                if (membership)
                    return next(new errors_1.ConflictError('El jugador ya pertenece a este equipo'));
                return next(new errors_1.ConflictError('El dorsal ya está ocupado en este equipo'));
            }
            if (e?.code === 'P2003')
                return next(new errors_1.NotFoundError('Jugador'));
            next(e);
        }
    },
    async lookupByPhone(req, res, next) {
        try {
            const p = validator_1.lookupJugadorByPhoneSchema.safeParse(req.body);
            if (!p.success)
                throw new errors_1.ValidationError(p.error.issues[0].message);
            await assertTeamOwner(req.params.equipoId, req);
            const jugador = await database_1.prisma.jugador.findFirst({
                where: {
                    user: { is: { phoneNumber: p.data.telefono, phoneNumberVerified: true } },
                },
                select: {
                    id: true,
                    nombre: true,
                    foto: true,
                    posicion: true,
                    equipos: {
                        where: { equipoId: req.params.equipoId },
                        select: { dorsal: true },
                        take: 1,
                    },
                },
            });
            if (!jugador)
                throw new errors_1.AppError(404, 'No encontramos un perfil de jugador con este teléfono');
            const membership = jugador.equipos[0];
            (0, response_1.ok)(res, {
                id: jugador.id,
                nombre: jugador.nombre,
                foto: jugador.foto,
                posicion: jugador.posicion,
                yaPertenece: Boolean(membership),
                dorsal: membership?.dorsal ?? null,
            });
        }
        catch (e) {
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
            await assertCanManageDivisionRoster(p.data.divisionId, p.data.equipoId, req);
            const teamPlayer = await database_1.prisma.equipoJugador.findUnique({
                where: { equipoId_jugadorId: { equipoId: p.data.equipoId, jugadorId: p.data.jugadorId } },
                select: { jugadorId: true, dorsal: true },
            });
            if (!teamPlayer)
                throw new errors_1.ValidationError('El jugador debe pertenecer al equipo');
            const result = await database_1.prisma.divisionJugador.create({ data: { ...p.data, dorsal: teamPlayer.dorsal }, include: { jugador: true } });
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
            await assertCanManageDivisionRoster(req.params.divisionId, req.params.equipoId, req);
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
                const linked = await database_1.prisma.$transaction(async (tx) => {
                    await service_1.mediaService.lockAttachmentTarget(tx, 'jugador', byPhone.id);
                    const current = await tx.jugador.findUniqueOrThrow({ where: { id: byPhone.id }, select: { foto: true, fotoPublicId: true } });
                    const media = await service_1.mediaService.prepareAttachment(tx, p.data.photoAssetId, user.id, 'PLAYER_PHOTO', current.foto, current.fotoPublicId);
                    return tx.jugador.update({
                        where: { id: byPhone.id },
                        data: { userId: user.id, ...(media && { foto: media.url, fotoPublicId: media.publicId }) },
                        include: jugadorInclude,
                    });
                });
                (0, jobSignals_1.signalBackgroundJob)('media-deletion');
                return (0, response_1.ok)(res, linked, 'Perfil de jugador vinculado');
            }
            const { photoAssetId, ...profileData } = p.data;
            const jugador = await database_1.prisma.$transaction(async (tx) => {
                const media = await service_1.mediaService.prepareAttachment(tx, photoAssetId, user.id, 'PLAYER_PHOTO');
                return tx.jugador.create({
                    data: { ...profileData, telefono: user.phoneNumber, userId: user.id, ...(media && { foto: media.url, fotoPublicId: media.publicId }) },
                    include: jugadorInclude,
                });
            });
            (0, jobSignals_1.signalBackgroundJob)('media-deletion');
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
            const { photoAssetId, ...profileData } = p.data;
            const updated = await database_1.prisma.$transaction(async (tx) => {
                await service_1.mediaService.lockAttachmentTarget(tx, 'jugador', jugador.id);
                const current = await tx.jugador.findUniqueOrThrow({ where: { id: jugador.id }, select: { foto: true, fotoPublicId: true } });
                const media = await service_1.mediaService.prepareAttachment(tx, photoAssetId, req.user.id, 'PLAYER_PHOTO', current.foto, current.fotoPublicId);
                return tx.jugador.update({
                    where: { id: jugador.id },
                    data: { ...profileData, ...(media && { foto: media.url, fotoPublicId: media.publicId }) },
                    include: jugadorInclude,
                });
            });
            (0, jobSignals_1.signalBackgroundJob)('media-deletion');
            (0, response_1.ok)(res, updated, 'Perfil actualizado');
        }
        catch (e) {
            next(e);
        }
    },
};
//# sourceMappingURL=controller.js.map