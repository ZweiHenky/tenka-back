import { z } from 'zod';

const nombreSchema = z.string().trim().min(1, 'El nombre es requerido').max(20);

export const createSchema = z.object({
  nombre: nombreSchema,
  logo: z.string().optional(),
  logoPublicId: z.string().optional(),
  userId: z.string().min(1),
});

export const updateSchema = z.object({
  nombre: nombreSchema.optional(),
  logo: z.string().optional(),
  logoPublicId: z.string().optional(),
});

export type CreateInput = z.output<typeof createSchema>;
export type UpdateInput = z.output<typeof updateSchema>;
