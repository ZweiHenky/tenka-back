import { z } from 'zod';

export const createSchema = z.object({
  numero: z.number().int().min(1),
  fechaInicio: z.string().optional(),
  fechaFin: z.string().optional(),
  divisionId: z.string().min(1),
});

export const updateSchema = z.object({
  numero: z.number().int().min(1).optional(),
  fechaInicio: z.string().optional(),
  fechaFin: z.string().optional(),
});

export type CreateInput = z.output<typeof createSchema>;
export type UpdateInput = z.output<typeof updateSchema>;
