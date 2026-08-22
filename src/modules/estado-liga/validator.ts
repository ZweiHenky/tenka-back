import { z } from 'zod';
import { ESTADOS_LIGA } from './entity';

// Por defecto EN_CURSO: una fila creada sin código no debe volverse un borrador y esconder
// divisiones. Ante la duda, visible — el mismo criterio que el backfill de la migración.
const codigoSchema = z.enum(ESTADOS_LIGA).default('EN_CURSO');

export const createSchema = z.object({
  nombre: z.string().min(1, 'El nombre es requerido'),
  codigo: codigoSchema,
});

export const updateSchema = z.object({
  nombre: z.string().min(1).optional(),
  codigo: z.enum(ESTADOS_LIGA).optional(),
});

export type CreateInput = z.output<typeof createSchema>;
export type UpdateInput = z.output<typeof updateSchema>;
