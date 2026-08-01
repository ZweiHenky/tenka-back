"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationSubscriptionService = void 0;
const database_1 = require("../../config/database");
const errors_1 = require("../../utils/errors");
exports.notificationSubscriptionService = {
    async subscribe(data) {
        const division = await database_1.prisma.division.findFirst({
            where: { id: data.divisionId, estadoLiga: { nombre: { not: 'Borrador' } } },
            select: { id: true },
        });
        if (!division)
            throw new errors_1.NotFoundError('Division');
        return database_1.prisma.divisionNotificationSubscription.upsert({
            where: {
                divisionId_oneSignalId: { divisionId: data.divisionId, oneSignalId: data.oneSignalId },
            },
            create: {
                divisionId: data.divisionId,
                oneSignalId: data.oneSignalId,
                pushSubscriptionId: data.pushSubscriptionId ?? null,
            },
            update: {
                oneSignalId: data.oneSignalId,
                pushSubscriptionId: data.pushSubscriptionId ?? null,
            },
        });
    },
    async unsubscribe(data) {
        try {
            await database_1.prisma.divisionNotificationSubscription.delete({
                where: {
                    divisionId_oneSignalId: { divisionId: data.divisionId, oneSignalId: data.oneSignalId },
                },
            });
        }
        catch {
            // ignore if not found
        }
    },
};
//# sourceMappingURL=service.js.map