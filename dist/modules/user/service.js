"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userService = void 0;
const database_1 = require("../../config/database");
const errors_1 = require("../../utils/errors");
const service_1 = require("../media/service");
const jobSignals_1 = require("../../workers/jobSignals");
const sanitizedUserSelect = {
    id: true,
    email: true,
    emailVerified: true,
    name: true,
    image: true,
    phoneNumber: true,
    phoneNumberVerified: true,
    showPhoneInPublicLeague: true,
    rol: true,
    createdAt: true,
    updatedAt: true,
};
exports.userService = {
    async activateLeagueRole(userId) {
        await database_1.prisma.user.updateMany({
            where: { id: userId, rol: 'CAPITAN' },
            data: { rol: 'LIGA' },
        });
        const user = await database_1.prisma.user.findUnique({
            where: { id: userId },
            select: sanitizedUserSelect,
        });
        if (!user)
            throw new errors_1.NotFoundError('Usuario');
        return user;
    },
    async deleteAccount(userId, email) {
        const user = await database_1.prisma.user.findUnique({
            where: { id: userId },
            select: { email: true, image: true, imagePublicId: true },
        });
        if (!user)
            throw new errors_1.NotFoundError('Usuario');
        if (user.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
            throw new errors_1.ValidationError('El correo no coincide. Escribe el correo de tu cuenta para confirmar.');
        }
        await database_1.prisma.$transaction(async (tx) => {
            const ligas = await tx.liga.findMany({
                where: { userId },
                select: { logo: true, logoPublicId: true, cancha: true, canchaPublicId: true },
            });
            for (const liga of ligas) {
                await service_1.mediaService.scheduleImageCleanup(liga.logo, liga.logoPublicId, tx);
                await service_1.mediaService.scheduleImageCleanup(liga.cancha, liga.canchaPublicId, tx);
            }
            await tx.liga.deleteMany({ where: { userId } });
            const equipos = await tx.equipo.findMany({
                where: { userId },
                select: { logo: true, logoPublicId: true },
            });
            for (const equipo of equipos) {
                await service_1.mediaService.scheduleImageCleanup(equipo.logo, equipo.logoPublicId, tx);
            }
            await tx.equipo.deleteMany({ where: { userId } });
            const jugador = await tx.jugador.findFirst({
                where: { userId },
                select: { id: true, foto: true, fotoPublicId: true },
            });
            if (jugador) {
                await service_1.mediaService.scheduleImageCleanup(jugador.foto, jugador.fotoPublicId, tx);
                await tx.jugador.delete({ where: { id: jugador.id } });
            }
            await tx.partidoRefereeAccess.deleteMany({ where: { createdById: userId } });
            const subscriptions = await tx.divisionNotificationSubscription.findMany({
                where: { userId },
                select: { oneSignalId: true, divisionId: true },
            });
            for (const subscription of subscriptions) {
                const tag = `division_${subscription.divisionId}`;
                await tx.oneSignalTagCleanupJob.upsert({
                    where: { oneSignalId_tag: { oneSignalId: subscription.oneSignalId, tag } },
                    create: { oneSignalId: subscription.oneSignalId, tag, desired: false },
                    update: { desired: false, status: 'PENDING', attempts: 0, lastError: null, deadAt: null, leaseUntil: null, lockedBy: null, nextTryAt: new Date() },
                });
            }
            await tx.divisionNotificationSubscription.deleteMany({ where: { userId } });
            const mediaAssets = await tx.mediaAsset.findMany({
                where: { ownerId: userId, status: { in: ['PENDING', 'UPLOADED', 'ATTACHED'] } },
                select: { publicId: true },
            });
            for (const asset of mediaAssets) {
                await service_1.mediaService.scheduleDeletion(asset.publicId, tx);
            }
            await service_1.mediaService.scheduleImageCleanup(user.image, user.imagePublicId, tx);
            await tx.user.delete({ where: { id: userId } });
        });
        (0, jobSignals_1.signalBackgroundJob)('media-deletion');
        (0, jobSignals_1.signalBackgroundJob)('tag-cleanup');
    },
};
//# sourceMappingURL=service.js.map