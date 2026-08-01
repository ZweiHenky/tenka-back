"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userService = void 0;
const database_1 = require("../../config/database");
const errors_1 = require("../../utils/errors");
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
};
//# sourceMappingURL=service.js.map