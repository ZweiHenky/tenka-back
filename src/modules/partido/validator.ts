import { z } from 'zod';

export const createSchema = z.object({
  golesLocal: z.number().int().min(0).default(0),
  golesVisitante: z.number().int().min(0).default(0),
  penalesLocal: z.number().int().min(0).optional(),
  penalesVisitante: z.number().int().min(0).optional(),
  fecha: z.string().optional(),
  fechaFin: z.string().optional(),
  estado: z.enum(['PROGRAMADO', 'EN_JUEGO', 'FINALIZADO', 'SUSPENDIDO']).optional(),
  llave: z.number().int().optional(),
  jornadaId: z.string().optional(),
  rondaPlayoffId: z.string().optional(),
  equipoLocalId: z.string().min(1),
  equipoVisitanteId: z.string().min(1),
  canchaId: z.string().optional(),
  tipoPartido: z.enum(['REGULAR', 'AMISTOSO', 'COMPLEMENTO', 'ELIMINATORIA']).optional(),
  exhibicionLocal: z.boolean().optional(),
  exhibicionVisitante: z.boolean().optional(),
});

export const updateSchema = z.object({
  golesLocal: z.number().int().min(0).optional(),
  golesVisitante: z.number().int().min(0).optional(),
  penalesLocal: z.number().int().min(0).nullable().optional(),
  penalesVisitante: z.number().int().min(0).nullable().optional(),
  fecha: z.string().optional(),
  fechaFin: z.string().optional(),
  estado: z.enum(['PROGRAMADO', 'EN_JUEGO', 'FINALIZADO', 'SUSPENDIDO']).optional(),
  llave: z.number().int().optional(),
  jornadaId: z.string().optional(),
  rondaPlayoffId: z.string().optional(),
  equipoLocalId: z.string().min(1).optional(),
  equipoVisitanteId: z.string().min(1).optional(),
  canchaId: z.string().optional(),
  tipoPartido: z.enum(['REGULAR', 'AMISTOSO', 'COMPLEMENTO', 'ELIMINATORIA']).optional(),
  exhibicionLocal: z.boolean().optional(),
  exhibicionVisitante: z.boolean().optional(),
});

export type CreateInput = z.output<typeof createSchema>;
export type UpdateInput = z.output<typeof updateSchema>;
