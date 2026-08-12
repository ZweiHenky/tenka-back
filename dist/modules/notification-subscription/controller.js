"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationSubscriptionController = exports.notificationSubscriptionSchemas = exports.NOTIFICATION_SYNC_DIVISION_LIMIT = void 0;
const zod_1 = require("zod");
const service_1 = require("./service");
const response_1 = require("../../utils/response");
const errors_1 = require("../../utils/errors");
const id = zod_1.z.string().trim().min(1).max(200);
const subscribeSchema = zod_1.z.object({
    divisionId: id,
    oneSignalId: id,
    pushSubscriptionId: id,
});
const unsubscribeSchema = zod_1.z.object({
    divisionId: id,
    oneSignalId: id.optional(),
    pushSubscriptionId: id,
});
exports.NOTIFICATION_SYNC_DIVISION_LIMIT = 100;
const syncSchema = zod_1.z.object({
    oneSignalId: id,
    pushSubscriptionId: id,
    divisionIds: zod_1.z.array(id).max(exports.NOTIFICATION_SYNC_DIVISION_LIMIT),
});
exports.notificationSubscriptionSchemas = { subscribeSchema, unsubscribeSchema, syncSchema };
exports.notificationSubscriptionController = {
    async sync(req, res, next) {
        try {
            const parsed = syncSchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            const state = await service_1.notificationSubscriptionService.sync({ ...parsed.data, userId: req.user?.id ?? null });
            (0, response_1.ok)(res, state);
        }
        catch (err) {
            next(err);
        }
    },
    async subscribe(req, res, next) {
        try {
            const parsed = subscribeSchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            const sub = await service_1.notificationSubscriptionService.subscribe({ ...parsed.data, userId: req.user?.id ?? null });
            (0, response_1.created)(res, sub);
        }
        catch (err) {
            next(err);
        }
    },
    async unsubscribe(req, res, next) {
        try {
            const parsed = unsubscribeSchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            await service_1.notificationSubscriptionService.unsubscribe(parsed.data);
            (0, response_1.noContent)(res);
        }
        catch (err) {
            next(err);
        }
    },
};
//# sourceMappingURL=controller.js.map