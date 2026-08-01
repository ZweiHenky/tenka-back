import { z } from 'zod';

export const createSchema = z.object({
  nombre: z.string().min(1, 'El nombre es requerido'),
});

export const updateSchema = z.object({
  nombre: z.string().min(1).optional(),
});

export type CreateInput = z.output<typeof createSchema>;
export type UpdateInput = z.output<typeof updateSchema>;
