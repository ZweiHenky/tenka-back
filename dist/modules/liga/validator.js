"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateArbitroSchema = exports.createArbitroSchema = exports.updateCanchaSchema = exports.createCanchaSchema = exports.updateLigaSchema = exports.createLigaSchema = void 0;
const zod_1 = require("zod");
const nombreSchema = zod_1.z.string().trim().min(1).max(20);
const descripcionSchema = zod_1.z.string().max(150);
const createCanchaItemSchema = zod_1.z.object({
    nombre: zod_1.z.string().trim().min(1).max(50),
});
const updateCanchaItemSchema = zod_1.z.object({
    id: zod_1.z.string().min(1).optional(),
    nombre: zod_1.z.string().trim().min(1).max(50).optional(),
    activa: zod_1.z.boolean().optional(),
}).superRefine((cancha, ctx) => {
    if (!cancha.id && !cancha.nombre) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ['nombre'],
            message: 'Una cancha nueva debe tener nombre',
        });
    }
});
const arbitroItemSchema = zod_1.z.object({
    nombre: zod_1.z.string().trim().min(1).max(50),
});
function validateCanchas(data, ctx) {
    const activeNamed = data.canchas?.filter((cancha) => cancha.activa !== false && cancha.nombre) ?? [];
    if (data.multiplesCanchas && activeNamed.length < 2) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ['canchas'],
            message: 'Una liga con múltiples canchas debe tener al menos 2 canchas',
        });
    }
    if (data.canchas) {
        const nombres = data.canchas
            .flatMap((cancha) => cancha.nombre ? [cancha.nombre.toLowerCase()] : []);
        if (new Set(nombres).size !== nombres.length) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                path: ['canchas'],
                message: 'Los nombres de las canchas no pueden repetirse',
            });
        }
    }
}
function validateArbitros(data, ctx) {
    if (data.usaArbitros && (!data.arbitros || data.arbitros.length < 2)) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ['arbitros'],
            message: 'Debes agregar al menos 2 árbitros',
        });
    }
    if (data.arbitros) {
        const nombres = data.arbitros.map((a) => a.nombre.toLocaleLowerCase());
        if (new Set(nombres).size !== nombres.length) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                path: ['arbitros'],
                message: 'Los nombres de los árbitros no pueden repetirse',
            });
        }
    }
}
exports.createLigaSchema = zod_1.z.object({
    nombre: nombreSchema,
    descripcion: descripcionSchema,
    logoAssetId: zod_1.z.string().min(1).nullable().optional(),
    coverAssetId: zod_1.z.string().min(1).nullable().optional(),
    multiplesCanchas: zod_1.z.boolean().optional(),
    canchas: zod_1.z.array(createCanchaItemSchema).optional(),
    usaArbitros: zod_1.z.boolean().optional(),
    arbitros: zod_1.z.array(arbitroItemSchema).optional(),
    ubicacionId: zod_1.z.string(),
}).superRefine(validateCanchas).superRefine(validateArbitros);
exports.updateLigaSchema = zod_1.z.object({
    nombre: nombreSchema.optional(),
    descripcion: descripcionSchema.optional(),
    logoAssetId: zod_1.z.string().min(1).nullable().optional(),
    coverAssetId: zod_1.z.string().min(1).nullable().optional(),
    multiplesCanchas: zod_1.z.boolean().optional(),
    canchas: zod_1.z.array(updateCanchaItemSchema).optional(),
    usaArbitros: zod_1.z.boolean().optional(),
    arbitros: zod_1.z.array(arbitroItemSchema).optional(),
    ubicacionId: zod_1.z.string().optional(),
}).superRefine((data, ctx) => {
    if (data.canchas)
        validateCanchas({ ...data, multiplesCanchas: undefined }, ctx);
}).superRefine((data, ctx) => {
    if (data.arbitros)
        validateArbitros(data, ctx);
});
exports.createCanchaSchema = zod_1.z.object({
    nombre: zod_1.z.string().trim().min(1).max(50),
});
exports.updateCanchaSchema = zod_1.z.object({
    nombre: zod_1.z.string().trim().min(1).max(50).optional(),
    activa: zod_1.z.boolean().optional(),
});
exports.createArbitroSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(1).max(50),
});
exports.updateArbitroSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(1).max(50).optional(),
    activo: zod_1.z.boolean().optional(),
});
//# sourceMappingURL=validator.js.map