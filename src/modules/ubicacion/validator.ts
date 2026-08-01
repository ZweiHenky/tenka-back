import { z } from 'zod';

export const createSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  nombreCompleto: z.string().min(1),
  estado: z.string().min(1),
  municipio: z.string().min(1),
});

export const updateSchema = z.object({
  lat: z.number().optional(),
  lng: z.number().optional(),
  nombreCompleto: z.string().min(1).optional(),
  estado: z.string().min(1).optional(),
  municipio: z.string().min(1).optional(),
});

export const findOrCreateSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  nombreCompleto: z.string().min(1),
  estado: z.string().min(1),
  municipio: z.string().min(1),
});

export type CreateInput = z.output<typeof createSchema>;
export type UpdateInput = z.output<typeof updateSchema>;
export type FindOrCreateInput = z.output<typeof findOrCreateSchema>;
