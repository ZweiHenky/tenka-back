"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.divisionJugadorSchema = exports.updateMeSchema = exports.createMeSchema = exports.assignJugadorSchema = exports.updateJugadorSchema = exports.createJugadorSchema = exports.posicionJugadorSchema = void 0;
const zod_1 = require("zod");
exports.posicionJugadorSchema = zod_1.z.enum(['PORTERO', 'DEFENSA', 'LATERAL', 'CONTENCION', 'MEDIO', 'EXTREMO', 'DELANTERO']);
exports.createJugadorSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(1),
    posicion: exports.posicionJugadorSchema,
    foto: zod_1.z.string().optional(),
    fotoPublicId: zod_1.z.string().optional(),
    edad: zod_1.z.number().int().min(0).max(120).optional(),
    telefono: zod_1.z.string().min(8),
    equipoId: zod_1.z.string().min(1),
    dorsal: zod_1.z.number().int().min(0).max(999),
});
exports.updateJugadorSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(1).optional(),
    posicion: exports.posicionJugadorSchema.optional(),
    foto: zod_1.z.string().nullable().optional(),
    fotoPublicId: zod_1.z.string().nullable().optional(),
    edad: zod_1.z.number().int().min(0).max(120).nullable().optional(),
    telefono: zod_1.z.string().nullable().optional(),
    dorsal: zod_1.z.number().int().min(0).max(999).optional(),
    equipoId: zod_1.z.string().min(1).optional(),
});
exports.assignJugadorSchema = zod_1.z.object({
    equipoId: zod_1.z.string().min(1),
    jugadorId: zod_1.z.string().min(1),
    dorsal: zod_1.z.number().int().min(0).max(999),
});
exports.createMeSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(1),
    posicion: exports.posicionJugadorSchema,
    foto: zod_1.z.string().optional(),
    fotoPublicId: zod_1.z.string().optional(),
    edad: zod_1.z.number().int().min(0).max(120).optional(),
});
exports.updateMeSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(1).optional(),
    posicion: exports.posicionJugadorSchema.optional(),
    foto: zod_1.z.string().nullable().optional(),
    fotoPublicId: zod_1.z.string().nullable().optional(),
    edad: zod_1.z.number().int().min(0).max(120).nullable().optional(),
    showPhoneInPublicProfile: zod_1.z.boolean().optional(),
});
exports.divisionJugadorSchema = zod_1.z.object({
    divisionId: zod_1.z.string().min(1),
    equipoId: zod_1.z.string().min(1),
    jugadorId: zod_1.z.string().min(1),
});
//# sourceMappingURL=validator.js.map