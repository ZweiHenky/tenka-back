"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSchema = exports.createSchema = void 0;
const zod_1 = require("zod");
exports.createSchema = zod_1.z.object({
    partidosJugados: zod_1.z.number().int().min(0).default(0),
    ganados: zod_1.z.number().int().min(0).default(0),
    empatados: zod_1.z.number().int().min(0).default(0),
    perdidos: zod_1.z.number().int().min(0).default(0),
    golesFavor: zod_1.z.number().int().min(0).default(0),
    golesContra: zod_1.z.number().int().min(0).default(0),
    diferenciaGoles: zod_1.z.number().int().default(0),
    puntos: zod_1.z.number().int().min(0).default(0),
    divisionId: zod_1.z.string().min(1),
    equipoId: zod_1.z.string().min(1),
});
exports.updateSchema = zod_1.z.object({
    partidosJugados: zod_1.z.number().int().min(0).optional(),
    ganados: zod_1.z.number().int().min(0).optional(),
    empatados: zod_1.z.number().int().min(0).optional(),
    perdidos: zod_1.z.number().int().min(0).optional(),
    golesFavor: zod_1.z.number().int().min(0).optional(),
    golesContra: zod_1.z.number().int().min(0).optional(),
    diferenciaGoles: zod_1.z.number().int().optional(),
    puntos: zod_1.z.number().int().min(0).optional(),
});
//# sourceMappingURL=validator.js.map