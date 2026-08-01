"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mediaController = void 0;
const zod_1 = require("zod");
const response_1 = require("../../utils/response");
const service_1 = require("./service");
const errors_1 = require("../../utils/errors");
const env_1 = require("../../config/env");
const signUploadSchema = zod_1.z.object({
    folder: zod_1.z.string().optional(),
    public_id: zod_1.z.string().optional(),
});
exports.mediaController = {
    async signUpload(req, res, next) {
        try {
            const parsed = signUploadSchema.safeParse(req.body);
            if (!parsed.success)
                throw new errors_1.ValidationError(parsed.error.issues[0].message);
            const params = {
                ...(parsed.data.folder && { folder: parsed.data.folder }),
                ...(parsed.data.public_id && { public_id: parsed.data.public_id }),
            };
            const { signature, timestamp } = service_1.mediaService.generateSignature(params);
            (0, response_1.ok)(res, {
                signature,
                timestamp,
                apiKey: env_1.env.CLOUDINARY_API_KEY,
                cloudName: env_1.env.CLOUDINARY_CLOUD_NAME,
            });
        }
        catch (err) {
            next(err);
        }
    },
};
//# sourceMappingURL=controller.js.map