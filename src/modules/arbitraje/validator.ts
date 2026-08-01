import { z } from 'zod';

export const asignacionesLigaSchema = z.object({
  asignacionId: z.string().optional(),
  divisionIds: z.array(z.string()),
  asignaciones: z.array(z.object({ partidoId: z.string(), arbitroIds: z.array(z.string()) })),
});
