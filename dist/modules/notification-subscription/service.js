"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationSubscriptionService = void 0;
const database_1 = require("../../config/database");
const errors_1 = require("../../utils/errors");
exports.notificationSubscriptionService = {
    async subscribe(data) {
        return database_1.prisma.$transaction(async (tx) => {
            const division = await tx.division.findFirst({
                where: { id: data.divisionId, estadoLiga: { nombre: { not: 'Borrador' } } },
                select: { id: true },
            });
            if (!division)
                throw new errors_1.NotFoundError('Division');
            const subscription = await tx.divisionNotificationSubscription.upsert({
                where: { divisionId_oneSignalId: { divisionId: data.divisionId, oneSignalId: data.oneSignalId } },
                create: {
                    divisionId: data.divisionId,
                    oneSignalId: data.oneSignalId,
                    pushSubscriptionId: data.pushSubscriptionId,
                    userId: data.userId ?? null,
                },
                update: {
                    pushSubscriptionId: data.pushSubscriptionId,
                    ...(data.userId ? { userId: data.userId } : {}),
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