import { z } from 'zod';

export const createCategoriaSchema = z.object({
  nombre: z.string().min(1, 'El nombre es requerido'),
});

export const updateCategoriaSchema = z.object({
  nombre: z.string().min(1).optional(),
});

export type CreateCategoriaInput = z.output<typeof createCategoriaSchema>;
export type UpdateCategoriaInput = z.output<typeof updateCategoriaSchema>;
