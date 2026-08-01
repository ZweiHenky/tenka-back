"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findOrCreateSchema = exports.updateSchema = exports.createSchema = void 0;
const zod_1 = require("zod");
exports.createSchema = zod_1.z.object({
    lat: zod_1.z.number(),
    lng: zod_1.z.number(),
    nombreCompleto: zod_1.z.string().min(1),
    estado: zod_1.z.string().min(1),
    municipio: zod_1.z.string().min(1),
});
exports.updateSchema = zod_1.z.object({
    lat: zod_1.z.number().optional(),
    lng: zod_1.z.number().optional(),
    nombreCompleto: zod_1.z.string().min(1).optional(),
    estado: zod_1.z.string().min(1).optional(),
    municipio: zod_1.z.string().min(1).optional(),
});
exports.findOrCreateSchema = zod_1.z.object({
    lat: zod_1.z.number(),
    lng: zod_1.z.number(),
    nombreCompleto: zod_1.z.string().min(1),
    estado: zod_1.z.string().min(1),
    municipio: zod_1.z.string().min(1),
});
//# sourceMappingURL=validator.js.map