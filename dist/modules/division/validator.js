"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateDivisionSchema = exports.createDivisionSchema = void 0;
const zod_1 = require("zod");
exports.createDivisionSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(1),
    maxEquipos: zod_1.z.number().int().min(2),
    arbitraje: zod_1.z.number().min(0).default(0),
    diasPartido: zod_1.z.string().min(1),
    horarioPartido: zod_1.z.string().min(1),
    duracionPartido: zod_1.z.number().int().min(1).optional(),
    descanso: zod_1.z.number().int().min(0).optional(),
    fechaInicio: zod_1.z.string().datetime().optional(),
    fechaFin: zod_1.z.string().datetime().optional(),
    estadoLigaId: zod_1.z.string().optional(),
    ligaId: zod_1.z.string(),
    categoriaId: zod_1.z.string(),
    tipoId: zod_1.z.string(),
    tipoCompetenciaId: zod_1.z.string(),
});
exports.updateDivisionSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(1).optional(),
    maxEquipos: zod_1.z.number().int().min(2).optional(),
    arbitraje: zod_1.z.number().min(0).optional(),
    diasPartido: zod_1.z.string().min(1).optional(),
    horarioPartido: zod_1.z.string().min(1).optional(),
    duracionPartido: zod_1.z.number().int().min(1).optional(),
    descanso: zod_1.z.number().int().min(0).optional(),
    fechaInicio: zod_1.z.string().datetime().optional(),
    fechaFin: zod_1.z.string().datetime().optional(),
    estadoLigaId: zod_1.z.string().optional(),
    ligaId: zod_1.z.string().optional(),
    categoriaId: zod_1.z.string().optional(),
    tipoId: zod_1.z.string().optional(),
    tipoCompetenciaId: zod_1.z.string().optional(),
});
//# sourceMappingURL=validator.js.map