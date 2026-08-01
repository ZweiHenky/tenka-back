import { z } from 'zod';

export const createSchema = z.object({
  partidosJugados: z.number().int().min(0).default(0),
  ganados: z.number().int().min(0).default(0),
  empatados: z.number().int().min(0).default(0),
  perdidos: z.number().int().min(0).default(0),
  golesFavor: z.number().int().min(0).default(0),
  golesContra: z.number().int().min(0).default(0),
  diferenciaGoles: z.number().int().default(0),
  puntos: z.number().int().min(0).default(0),
  divisionId: z.string().min(1),
  equipoId: z.string().min(1),
});

export const updateSchema = z.object({
  partidosJugados: z.number().int().min(0).optional(),
  ganados: z.number().int().min(0).optional(),
  empatados: z.number().int().min(0).optional(),
  perdidos: z.number().int().min(0).optional(),
  golesFavor: z.number().int().min(0).optional(),
  golesContra: z.number().int().min(0).optional(),
  diferenciaGoles: z.number().int().optional(),
  puntos: z.number().int().min(0).optional(),
});

export type CreateInput = z.output<typeof createSchema>;
export type UpdateInput = z.output<typeof updateSchema>;
