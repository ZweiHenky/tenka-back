import { z } from 'zod';

export const createDivisionSchema = z.object({
  nombre: z.string().min(1),
  maxEquipos: z.number().int().min(2),
  arbitraje: z.number().min(0).default(0),
  diasPartido: z.string().min(1),
  horarioPartido: z.string().min(1),
  duracionPartido: z.number().int().min(1).optional(),
  descanso: z.number().int().min(0).optional(),
  fechaInicio: z.string().datetime().optional(),
  fechaFin: z.string().datetime().optional(),
  estadoLigaId: z.string().optional(),
  ligaId: z.string(),
  categoriaId: z.string(),
  tipoId: z.string(),
  tipoCompetenciaId: z.string(),
});

export const updateDivisionSchema = z.object({
  nombre: z.string().min(1).optional(),
  maxEquipos: z.number().int().min(2).optional(),
  arbitraje: z.number().min(0).optional(),
  diasPartido: z.string().min(1).optional(),
  horarioPartido: z.string().min(1).optional(),
  duracionPartido: z.number().int().min(1).optional(),
  descanso: z.number().int().min(0).optional(),
  fechaInicio: z.string().datetime().optional(),
  fechaFin: z.string().datetime().optional(),
  estadoLigaId: z.string().optional(),
  ligaId: z.string().optional(),
  categoriaId: z.string().optional(),
  tipoId: z.string().optional(),
  tipoCompetenciaId: z.string().optional(),
});

export type CreateDivisionInput = z.output<typeof createDivisionSchema>;
export type UpdateDivisionInput = z.output<typeof updateDivisionSchema>;
