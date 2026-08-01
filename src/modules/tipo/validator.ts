import { z } from 'zod';
export const createTipoSchema = z.object({ nombre: z.string().min(1) });
export const updateTipoSchema = z.object({ nombre: z.string().min(1).optional() });
export type CreateTipoInput = z.output<typeof createTipoSchema>;
export type UpdateTipoInput = z.output<typeof updateTipoSchema>;
