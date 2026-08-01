"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSchema = exports.updateSchema = exports.createSchema = void 0;
const zod_1 = require("zod");
exports.createSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(1),
    orden: zod_1.z.number().int().min(1),
    divisionId: zod_1.z.string().min(1),
});
exports.updateSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(1).optional(),
    orden: zod_1.z.number().int().min(1).optional(),
});
exports.generateSchema = zod_1.z.object({
    divisionId: zod_1.z.string().min(1),
    cantidadEquipos: zod_1.z.number().int().refine((n) => [2, 4, 8, 16, 32].includes(n), {
        message: 'Debe ser 2, 4, 8, 16 o 32',
    }),
});
//# sourceMappingURL=validator.js.map