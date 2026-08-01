import { z } from 'zod';

export const createSchema = z.object({
  nombre: z.string().min(1),
  orden: z.number().int().min(1),
  divisionId: z.string().min(1),
});

export const updateSchema = z.object({
  nombre: z.string().min(1).optional(),
  orden: z.number().int().min(1).optional(),
});

export const generateSchema = z.object({
  divisionId: z.string().min(1),
  cantidadEquipos: z.number().int().refine((n) => [2, 4, 8, 16, 32].includes(n), {
    message: 'Debe ser 2, 4, 8, 16 o 32',
  }),
});

export type CreateInput = z.output<typeof createSchema>;
export type UpdateInput = z.output<typeof updateSchema>;
