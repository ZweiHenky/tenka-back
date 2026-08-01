"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refereeResultSchema = void 0;
const zod_1 = require("zod");
exports.refereeResultSchema = zod_1.z.object({
    golesLocal: zod_1.z.number().int().min(0).max(99),
    golesVisitante: zod_1.z.number().int().min(0).max(99),
    penalesLocal: zod_1.z.number().int().min(0).max(99).optional().nullable(),
    penalesVisitante: zod_1.z.number().int().min(0).max(99).optional().nullable(),
    estado: zod_1.z.literal('FINALIZADO'),
}).strict();
//# sourceMappingURL=validator.js.map