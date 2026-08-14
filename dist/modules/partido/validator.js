"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resultSchema = exports.notasSchema = exports.participacionSchema = exports.allocationSchema = exports.updateSchema = exports.createInJornadaSchema = exports.createSchema = void 0;
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
exports.createInJornadaSchema = zod_1.z.object({
    equipoLocalId: zod_1.z.string().min(1),
    equipoVisitanteId: zod_1.z.string().min(1),
    tipoPartido: zod_1.z.enum(['REGULAR', 'COMPLEMENTO']),
    fecha: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD').refine((value) => {
        const [year, month, day] = value.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
    }, 'La fecha no es válida'),
    horaInicio: zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'La hora de inicio debe tener formato HH:mm'),
    horaFin: zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'La hora fin debe tener formato HH:mm'),
    canchaId: zod_1.z.string().min(1).nullable().optional(),
}).strict();
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
exports.participacionSchema = zod_1.z.object({
    ladoMarcador: zod_1.z.enum(['LOCAL', 'VISITANTE']),
    jugadorId: zod_1.z.string().min(1),
}).strict();
exports.notasSchema = zod_1.z
    .string()
    .trim()
    .max(1000, 'Las notas no pueden superar los 1000 caracteres')
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();
exports.resultSchema = zod_1.z.object({
    expectedVersion: zod_1.z.number().int().min(0),
    estado: zod_1.z.enum(['FINALIZADO', 'PROGRAMADO', 'SUSPENDIDO']),
    golesLocal: zod_1.z.number().int().min(0).max(99),
    golesVisitante: zod_1.z.number().int().min(0).max(99),
    penalesLocal: zod_1.z.number().int().min(0).max(99).nullable().optional(),
    penalesVisitante: zod_1.z.number().int().min(0).max(99).nullable().optional(),
    allocations: zod_1.z.array(exports.allocationSchema).max(198),
    participaciones: zod_1.z.array(exports.participacionSchema).max(198).optional(),
    notas: exports.notasSchema,
}).strict();
//# sourceMappingURL=validator.js.map