import { z } from 'zod';

export const createSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  nombreCompleto: z.string().min(1),
  estado: z.string().min(1),
  municipio: z.string().min(1),
});

export const updateSchema = z.object({
  lat: z.number().finite().min(-90).max(90).optional(),
  lng: z.number().finite().min(-180).max(180).optional(),
  nombreCompleto: z.string().min(1).optional(),
  estado: z.string().min(1).optional(),
  municipio: z.string().min(1).optional(),
});

export const findOrCreateSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  nombreCompleto: z.string().min(1),
  estado: z.string().min(1),
  municipio: z.string().min(1),
});

export type CreateInput = z.output<typeof createSchema>;
export type UpdateInput = z.output<typeof updateSchema>;
export type FindOrCreateInput = z.output<typeof findOrCreateSchema>;
