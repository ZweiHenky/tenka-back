import { z } from 'zod';
import { FORMATOS_COMPETENCIA } from './entity';

// Por defecto LIGA_Y_ELIMINATORIAS: es el comportamiento que tuvo siempre el catálogo, así que
// una fila creada sin código no cambia de forma silenciosa lo que la app muestra.
const codigoSchema = z.enum(FORMATOS_COMPETENCIA).default('LIGA_Y_ELIMINATORIAS');

export const createSchema = z.object({
  nombre: z.string().min(1, 'El nombre es requerido'),
  codigo: codigoSchema,
});

export const updateSchema = z.object({
  nombre: z.string().min(1).optional(),
  codigo: z.enum(FORMATOS_COMPETENCIA).optional(),
});

export type CreateInput = z.output<typeof createSchema>;
export type UpdateInput = z.output<typeof updateSchema>;
