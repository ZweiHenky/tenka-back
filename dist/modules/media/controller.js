"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mediaController = void 0;
const zod_1 = require("zod");
const response_1 = require("../../utils/response");
const service_1 = require("./service");
const errors_1 = require("../../utils/errors");
const kindSchema = zod_1.z.enum(['LEAGUE_LOGO', 'LEAGUE_COVER', 'TEAM_LOGO', 'ACCOUNT_AVATAR', 'PLAYER_PHOTO']);
const completionSchema = zod_1.z.object({
    intentId: zod_1.z.string().min(1),
    public_id: zod_1.z.string().min(1),
    secure_url: zod_1.z.url(),
    bytes: zod_1.z.number().int().positive(),
    format: zod_1.z.string().min(1),
    width: zod_1.z.number().int().positive(),
    height: zod_1.z.number().int().positive(),
});
function parse(schema, value) {
    const result = schema.safeParse(value);
    if (!result.success)
        throw new errors_1.ValidationError(result.error.issues[0].message);
    return result.data;
}
exports.mediaController = {
    async signUpload(req, res, next) {
        try {
            (0, response_1.ok)(res, await service_1.mediaService.createUploadIntent(req.user.id, parse(zod_1.z.object({ kind: kindSchema }), req.body).kind));
        }
        catch (err) {
            next(err);
        }
    },
    async complete(req, res, next) {
        try {
            const { intentId, ...metadata } = parse(completionSchema, req.body);
            (0, response_1.ok)(res, await service_1.mediaService.completeUpload(req.user.id, intentId, metadata));
        }
        catch (err) {
            next(err);
        }
    },
    async abandon(req, res, next) {
        try {
            await service_1.mediaService.abandonUpload(req.user.id, req.params.intentId);
            (0, response_1.noContent)(res);
        }
        catch (err) {
            next(err);
        }
    },
};
//# sourceMappingURL=controller.js.map