import { z } from 'zod';

const nombreSchema = z.string().trim().min(1, 'El nombre es requerido').max(20);

export const createSchema = z.object({
  nombre: nombreSchema,
  logoAssetId: z.string().min(1).nullable().optional(),
});

export const updateSchema = z.object({
  nombre: nombreSchema.optional(),
  logoAssetId: z.string().min(1).nullable().optional(),
});

export type CreateInput = z.output<typeof createSchema>;
export type UpdateInput = z.output<typeof updateSchema>;
