"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refereeResultSchema = void 0;
const zod_1 = require("zod");
const validator_1 = require("../partido/validator");
exports.refereeResultSchema = zod_1.z.object({
    expectedVersion: zod_1.z.number().int().min(0),
    golesLocal: zod_1.z.number().int().min(0).max(99),
    golesVisitante: zod_1.z.number().int().min(0).max(99),
    penalesLocal: zod_1.z.number().int().min(0).max(99).optional().nullable(),
    penalesVisitante: zod_1.z.number().int().min(0).max(99).optional().nullable(),
    estado: zod_1.z.literal('FINALIZADO'),
    allocations: zod_1.z.array(validator_1.allocationSchema).max(198),
    participaciones: zod_1.z.array(validator_1.participacionSchema).max(198).optional(),
    notas: validator_1.notasSchema,
}).strict();
//# sourceMappingURL=validator.js.map