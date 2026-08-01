"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userController = void 0;
const zod_1 = require("zod");
const database_1 = require("../../config/database");
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
const service_1 = require("../media/service");
const service_2 = require("./service");
const phoneVisibilitySchema = zod_1.z.object({
    showPhoneInPublicLeague: zod_1.z.boolean(),
});
const updateMeSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(50).optional(),
    image: zod_1.z.string().nullable().optional(),
    imagePublicId: zod_1.z.string().nullable().optional(),
});
exports.userController = {
    async activateLeagueRole(req, res, next) {
        try {
            const user = await service_2.userService.activateLeagueRole(req.user.id);
            (0, response_1.ok)(res, user, 'Rol de liga activado');
        }
        catch (err) {
            next(err);
        }
    },
    async updatePhoneVisibility(req, res, next) {
        try {
            const parsed = phoneVisibilitySchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            const user = await database_1.prisma.user.update({
                where: { id: req.user.id },
                data: { showPhoneInPublicLeague: parsed.data.showPhoneInPublicLeague },
                select: { id: true, showPhoneInPublicLeague: true },
            });
            (0, response_1.ok)(res, user, 'Preferencia actualizada');
        }
        catch (err) {
            next(err);
        }
    },
    async updateMe(req, res, next) {
        try {
            const parsed = updateMeSchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            if (parsed.data.image !== undefined) {
                const old = await database_1.prisma.user.findUnique({ where: { id: req.user.id }, select: { image: true, imagePublicId: true } });
                if (old && parsed.data.image !== old.image) {
                    await service_1.mediaService.scheduleImageCleanup(old.image, old.imagePublicId);
                }
            }
            const user = await database_1.prisma.user.update({
                where: { id: req.user.id },
                data: parsed.data,
                select: { id: true, name: true, image: true, imagePublicId: true },
            });
            (0, response_1.ok)(res, user, 'Perfil actualizado');
        }
        catch (err) {
            next(err);
        }
    },
};
//# sourceMappingURL=controller.js.map