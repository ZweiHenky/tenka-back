"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSchema = exports.createSchema = void 0;
const zod_1 = require("zod");
exports.createSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(1, 'El nombre es requerido'),
});
exports.updateSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(1).optional(),
});
//# sourceMappingURL=validator.js.map