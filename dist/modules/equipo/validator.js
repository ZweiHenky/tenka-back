"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSchema = exports.createSchema = void 0;
const zod_1 = require("zod");
const nombreSchema = zod_1.z.string().trim().min(1, 'El nombre es requerido').max(20);
exports.createSchema = zod_1.z.object({
    nombre: nombreSchema,
    logo: zod_1.z.string().optional(),
    logoPublicId: zod_1.z.string().optional(),
    userId: zod_1.z.string().min(1),
});
exports.updateSchema = zod_1.z.object({
    nombre: nombreSchema.optional(),
    logo: zod_1.z.string().optional(),
    logoPublicId: zod_1.z.string().optional(),
});
//# sourceMappingURL=validator.js.map