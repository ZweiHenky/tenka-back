import { z } from 'zod';

const nombreSchema = z.string().trim().min(1).max(20);
const descripcionSchema = z.string().max(150);
const socialUrlSchema = z.string().trim().max(500).refine((value) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}, 'Debe ser una URL HTTPS válida').nullable().optional();

const createCanchaItemSchema = z.object({
  nombre: z.string().trim().min(1).max(50),
});

const updateCanchaItemSchema = z.object({
  id: z.string().min(1).optional(),
  nombre: z.string().trim().min(1).max(50).optional(),
  activa: z.boolean().optional(),
}).superRefine((cancha, ctx) => {
  if (!cancha.id && !cancha.nombre) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nombre'],
      message: 'Una cancha nueva debe tener nombre',
    });
  }
});

const arbitroItemSchema = z.object({
  nombre: z.string().trim().min(1).max(50),
});

const reglaItemSchema = z.object({
  titulo: z.string().trim().min(1, 'El título de la regla es obligatorio').max(60, 'El título no puede superar los 60 caracteres'),
  detalle: z.string().trim().min(1, 'El detalle de la regla es obligatorio').max(500, 'El detalle no puede superar los 500 caracteres'),
});

function validateReglas(
  data: { reglas?: { titulo: string; detalle: string }[] },
  ctx: z.RefinementCtx,
) {
  if (!data.reglas) return;
  if (data.reglas.length > 30) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reglas'],
      message: 'Máximo 30 reglas o directivas',
    });
    return;
  }
  const titulos = data.reglas.map((regla) => regla.titulo.trim().toLowerCase());
  if (new Set(titulos).size !== titulos.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reglas'],
      message: 'Los títulos de las reglas no pueden repetirse',
    });
  }
}

function validateCanchas(
  data: { multiplesCanchas?: boolean; canchas?: { nombre?: string; activa?: boolean }[] },
  ctx: z.RefinementCtx,
) {
  const activeNamed = data.canchas?.filter((cancha) => cancha.activa !== false && cancha.nombre) ?? [];
  if (data.multiplesCanchas && activeNamed.length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['canchas'],
      message: 'Una liga con múltiples canchas debe tener al menos 2 canchas',
    });
  }

  if (data.canchas) {
    const nombres = data.canchas
      .flatMap((cancha) => cancha.nombre ? [cancha.nombre.toLowerCase()] : []);
    if (new Set(nombres).size !== nombres.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['canchas'],
        message: 'Los nombres de las canchas no pueden repetirse',
      });
    }
  }
}

function validateArbitros(
  data: { usaArbitros?: boolean; arbitros?: { nombre: string }[] },
  ctx: z.RefinementCtx,
) {
  if (data.usaArbitros && (!data.arbitros || data.arbitros.length < 2)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['arbitros'],
      message: 'Debes agregar al menos 2 árbitros',
    });
  }

  if (data.arbitros) {
    const nombres = data.arbitros.map((a) => a.nombre.toLocaleLowerCase());
    if (new Set(nombres).size !== nombres.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['arbitros'],
        message: 'Los nombres de los árbitros no pueden repetirse',
      });
    }
  }
}

export const createLigaSchema = z.object({
  nombre: nombreSchema,
  descripcion: descripcionSchema,
  logoAssetId: z.string().min(1).nullable().optional(),
  coverAssetId: z.string().min(1).nullable().optional(),
  multiplesCanchas: z.boolean().optional(),
  canchas: z.array(createCanchaItemSchema).optional(),
  usaArbitros: z.boolean().optional(),
  arbitros: z.array(arbitroItemSchema).optional(),
  reglas: z.array(reglaItemSchema).max(30).optional(),
  facebook: socialUrlSchema,
  x: socialUrlSchema,
  instagram: socialUrlSchema,
  tiktok: socialUrlSchema,
  ubicacionId: z.string(),
}).superRefine(validateCanchas).superRefine(validateArbitros).superRefine(validateReglas);

export const updateLigaSchema = z.object({
  nombre: nombreSchema.optional(),
  descripcion: descripcionSchema.optional(),
  logoAssetId: z.string().min(1).nullable().optional(),
  coverAssetId: z.string().min(1).nullable().optional(),
  multiplesCanchas: z.boolean().optional(),
  canchas: z.array(updateCanchaItemSchema).optional(),
  usaArbitros: z.boolean().optional(),
  arbitros: z.array(arbitroItemSchema).optional(),
  reglas: z.array(reglaItemSchema).max(30).optional(),
  facebook: socialUrlSchema,
  x: socialUrlSchema,
  instagram: socialUrlSchema,
  tiktok: socialUrlSchema,
  ubicacionId: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.canchas) validateCanchas({ ...data, multiplesCanchas: undefined }, ctx);
}).superRefine((data, ctx) => {
  if (data.arbitros) validateArbitros(data, ctx);
}).superRefine((data, ctx) => {
  if (data.reglas) validateReglas(data, ctx);
});

export const createCanchaSchema = z.object({
  nombre: z.string().trim().min(1).max(50),
});

export const updateCanchaSchema = z.object({
  nombre: z.string().trim().min(1).max(50).optional(),
  activa: z.boolean().optional(),
});

export const createArbitroSchema = z.object({
  nombre: z.string().min(1).max(50),
});

export const updateArbitroSchema = z.object({
  nombre: z.string().min(1).max(50).optional(),
  activo: z.boolean().optional(),
});

export type CreateLigaInput = z.output<typeof createLigaSchema>;
export type UpdateLigaInput = z.output<typeof updateLigaSchema>;
export type CreateCanchaInput = z.output<typeof createCanchaSchema>;
export type UpdateCanchaInput = z.output<typeof updateCanchaSchema>;
export type CreateArbitroInput = z.output<typeof createArbitroSchema>;
export type UpdateArbitroInput = z.output<typeof updateArbitroSchema>;
