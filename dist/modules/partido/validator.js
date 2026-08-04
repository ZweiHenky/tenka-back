"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resultSchema = exports.allocationSchema = exports.updateSchema = exports.createSchema = void 0;
const zod_1 = require("zod");
exports.createSchema = zod_1.z.object({
    golesLocal: zod_1.z.number().int().min(0).default(0),
    golesVisitante: zod_1.z.number().int().min(0).default(0),
    penalesLocal: zod_1.z.number().int().min(0).optional(),
    penalesVisitante: zod_1.z.number().int().min(0).optional(),
    fecha: zod_1.z.string().optional(),
    fechaFin: zod_1.z.string().optional(),
    estado: zod_1.z.enum(['PROGRAMADO', 'EN_JUEGO', 'FINALIZADO', 'SUSPENDIDO']).optional(),
    llave: zod_1.z.number().int().optional(),
    jornadaId: zod_1.z.string().optional(),
    rondaPlayoffId: zod_1.z.string().optional(),
    equipoLocalId: zod_1.z.string().min(1),
    equipoVisitanteId: zod_1.z.string().min(1),
    canchaId: zod_1.z.string().optional(),
    tipoPartido: zod_1.z.enum(['REGULAR', 'AMISTOSO', 'COMPLEMENTO', 'ELIMINATORIA']).optional(),
    exhibicionLocal: zod_1.z.boolean().optional(),
    exhibicionVisitante: zod_1.z.boolean().optional(),
});
exports.updateSchema = zod_1.z.object({
    golesLocal: zod_1.z.number().int().min(0).optional(),
    golesVisitante: zod_1.z.number().int().min(0).optional(),
    penalesLocal: zod_1.z.number().int().min(0).nullable().optional(),
    penalesVisitante: zod_1.z.number().int().min(0).nullable().optional(),
    estado: zod_1.z.enum(['PROGRAMADO', 'EN_JUEGO', 'FINALIZADO', 'SUSPENDIDO']).optional(),
    llave: zod_1.z.number().int().optional(),
    jornadaId: zod_1.z.string().optional(),
    rondaPlayoffId: zod_1.z.string().optional(),
    equipoLocalId: zod_1.z.string().min(1).optional(),
    equipoVisitanteId: zod_1.z.string().min(1).optional(),
    tipoPartido: zod_1.z.enum(['REGULAR', 'AMISTOSO', 'COMPLEMENTO', 'ELIMINATORIA']).optional(),
    exhibicionLocal: zod_1.z.boolean().optional(),
    exhibicionVisitante: zod_1.z.boolean().optional(),
}).strict();
exports.allocationSchema = zod_1.z.object({
    ladoMarcador: zod_1.z.enum(['LOCAL', 'VISITANTE']),
    jugadorId: zod_1.z.string().min(1).nullable(),
    cantidad: zod_1.z.number().int().positive().max(99),
}).strict();
exports.resultSchema = zod_1.z.object({
    expectedVersion: zod_1.z.number().int().min(0),
    estado: zod_1.z.enum(['FINALIZADO', 'PROGRAMADO', 'SUSPENDIDO']),
    golesLocal: zod_1.z.number().int().min(0).max(99),
    golesVisitante: zod_1.z.number().int().min(0).max(99),
    penalesLocal: zod_1.z.number().int().min(0).max(99).nullable().optional(),
    penalesVisitante: zod_1.z.number().int().min(0).max(99).nullable().optional(),
    allocations: zod_1.z.array(exports.allocationSchema).max(198),
}).strict();
//# sourceMappingURL=validator.js.map