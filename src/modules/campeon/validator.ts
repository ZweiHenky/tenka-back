import { z } from 'zod';

/**
 * El cliente manda solo ids: los nombres y el conteo de goles los resuelve el servidor contra la
 * base. Un snapshot que viniera del cliente sería falsificable.
 *
 * `jugadorId` es opcional a propósito — una división sin goles registrados no tiene a quién
 * premiar, y ahí el campeón se asigna solo. Mandar `null` borra al goleador anterior.
 */
export const assignSchema = z.object({
  equipoId: z.string().min(1),
  jugadorId: z.string().min(1).nullish(),
});

export type AssignInput = z.output<typeof assignSchema>;
