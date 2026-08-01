"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSchema = exports.createSchema = void 0;
const zod_1 = require("zod");
exports.createSchema = zod_1.z.object({
    numero: zod_1.z.number().int().min(1),
    fechaInicio: zod_1.z.string().optional(),
    fechaFin: zod_1.z.string().optional(),
    divisionId: zod_1.z.string().min(1),
});
exports.updateSchema = zod_1.z.object({
    numero: zod_1.z.number().int().min(1).optional(),
    fechaInicio: zod_1.z.string().optional(),
    fechaFin: zod_1.z.string().optional(),
});
//# sourceMappingURL=validator.js.map