"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationSubscriptionService = void 0;
const database_1 = require("../../config/database");
const errors_1 = require("../../utils/errors");
exports.notificationSubscriptionService = {
    async sync(data) {
        const divisionIds = [...new Set(data.divisionIds)].sort();
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                return await database_1.prisma.$transaction(async (tx) => {
                    if (divisionIds.length > 0) {
                        const publicDivisions = await tx.division.findMany({
                            where: { id: { in: divisionIds }, estadoLiga: { nombre: { not: 'Borrador' } } },
                            select: { id: true },
                        });
                        if (publicDivisions.length !== divisionIds.length)
                            throw new errors_1.NotFoundError('Division');
                    }
                    // Reconcile only this device. A OneSignal user can own multiple push subscriptions.
                    await tx.divisionNotificationSubscription.deleteMany({
                        where: { pushSubscriptionId: data.pushSubscriptionId },
                    });
                    if (divisionIds.length > 0) {
                        await tx.divisionNotificationSubscription.createMany({
                            data: divisionIds.map((divisionId) => ({
                                divisionId,
                                oneSignalId: data.oneSignalId,
                                pushSubscriptionId: data.pushSubscriptionId,
                                userId: data.userId ?? null,
                            })),
                        });
                    }
                    return tx.divisionNotificationSubscription.findMany({
                        where: {
                            oneSignalId: data.oneSignalId,
                            pushSubscriptionId: data.pushSubscriptionId,
                        },
                        select: { divisionId: true, oneSignalId: true, pushSubscriptionId: true, userId: true },
                        orderBy: { divisionId: 'asc' },
                    });
                }, { isolationLevel: 'Serializable' });
            }
            catch (error) {
                const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
                if (attempt < 2 && (code === 'P2002' || code === 'P2034'))
                    continue;
                throw error;
            }
        }
        throw new Error('Notification subscription reconciliation failed');
    },
    async subscribe(data) {
        return database_1.prisma.$transaction(async (tx) => {
            const division = await tx.division.findFirst({
                where: { id: data.divisionId, estadoLiga: { nombre: { not: 'Borrador' } } },
                select: { id: true },
            });
            if (!division)
                throw new errors_1.NotFoundError('Division');
            const subscription = await tx.divisionNotificationSubscription.upsert({
                where: { divisionId_pushSubscriptionId: { divisionId: data.divisionId, pushSubscriptionId: data.pushSubscriptionId } },
                create: {
                    divisionId: data.divisionId,
                    oneSignalId: data.oneSignalId,
                    pushSubscriptionId: data.pushSubscriptionId,
                    userId: data.userId ?? null,
                },
                update: {
                    oneSignalId: data.oneSignalId,
                    pushSubscriptionId: data.pushSubscriptionId,
                    userId: data.userId ?? null,
                },
            });
            return subscription;
        });
    },
    async unsubscribe(data) {
        await database_1.prisma.divisionNotificationSubscription.deleteMany({
            where: { divisionId: data.divisionId, pushSubscriptionId: data.pushSubscriptionId },
        });
    },
};
//# sourceMappingURL=service.js.map