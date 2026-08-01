import { z } from 'zod';

export const createSchema = z.object({
  posicion: z.number().int().min(1),
  titulo: z.string().min(1),
  monto: z.number().optional(),
  descripcion: z.string().optional(),
  divisionId: z.string().min(1),
});

export const updateSchema = z.object({
  posicion: z.number().int().min(1).optional(),
  titulo: z.string().min(1).optional(),
  monto: z.number().optional(),
  descripcion: z.string().optional(),
});

export type CreateInput = z.output<typeof createSchema>;
export type UpdateInput = z.output<typeof updateSchema>;
