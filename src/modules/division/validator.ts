import { z } from 'zod';
import { parseConfiguredRanges } from '../../utils/timeRanges';

/** Days + time range this division plays on ONE court. Absent court = it does not play there. */
const courtScheduleSchema = z.object({
  canchaId: z.string().min(1),
  diasPartido: z.string().min(1),
  horarioPartido: z.string().min(1)
    .refine((value) => parseConfiguredRanges(value).length > 0, 'Rango de horario inválido'),
});

function assertUniqueCourts(
  rows: Array<{ canchaId: string }> | undefined,
  ctx: z.RefinementCtx,
): void {
  if (!rows) return;
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.canchaId)) {
      ctx.addIssue({ code: 'custom', message: 'No repitas la misma cancha en los horarios', path: ['horariosPorCancha'] });
      return;
    }
    seen.add(row.canchaId);
  }
}

export const createDivisionSchema = z.object({
  nombre: z.string().min(1),
  maxEquipos: z.number().int().min(2),
  arbitraje: z.number().min(0).default(0),
  registrarParticipaciones: z.boolean().optional(),
  registrarGoleo: z.boolean().optional(),
  /** Partidos de la fase regular exigidos para alinear en eliminatorias. 0 = sin requisito. */
  minPartidosEliminatoria: z.number().int().min(0).max(99).optional(),
  usarPenalesEnEmpates: z.boolean().optional(),
  diasPartido: z.string().min(1).optional(),
  horarioPartido: z.string().min(1).optional(),
  horariosPorCancha: z.array(courtScheduleSchema).max(50).optional(),
  // Obligatoria: sin ella la división queda inservible — generateNext y las opciones de
  // creación de partido fallan al no poder calcular el fin de cada partido.
  duracionPartido: z.number().int().min(1),
  descanso: z.number().int().min(0).optional(),
  fechaInicio: z.string().datetime().optional(),
  fechaFin: z.string().datetime().optional(),
  estadoLigaId: z.string().optional(),
  ligaId: z.string(),
  categoriaId: z.string(),
  tipoId: z.string(),
  tipoCompetenciaId: z.string(),
}).superRefine((data, ctx) => {
  // Either the legacy scalars or at least one per-court row; both formats are accepted.
  if (!data.horariosPorCancha?.length && !(data.diasPartido && data.horarioPartido)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Configura días y horario de partido, o al menos una cancha con horario',
      path: ['horarioPartido'],
    });
  }
  assertUniqueCourts(data.horariosPorCancha, ctx);
});

export const updateDivisionSchema = z.object({
  nombre: z.string().min(1).optional(),
  maxEquipos: z.number().int().min(2).optional(),
  arbitraje: z.number().min(0).optional(),
  registrarParticipaciones: z.boolean().optional(),
  registrarGoleo: z.boolean().optional(),
  /** Partidos de la fase regular exigidos para alinear en eliminatorias. 0 = sin requisito. */
  minPartidosEliminatoria: z.number().int().min(0).max(99).optional(),
  usarPenalesEnEmpates: z.boolean().optional(),
  diasPartido: z.string().min(1).optional(),
  horarioPartido: z.string().min(1).optional(),
  /** Empty array clears the per-court rows and reverts the division to the scalars. */
  horariosPorCancha: z.array(courtScheduleSchema).max(50).optional(),
  duracionPartido: z.number().int().min(1).optional(),
  descanso: z.number().int().min(0).optional(),
  fechaInicio: z.string().datetime().optional(),
  fechaFin: z.string().datetime().optional(),
  estadoLigaId: z.string().optional(),
  ligaId: z.string().optional(),
  categoriaId: z.string().optional(),
  tipoId: z.string().optional(),
  // `tipoCompetenciaId` no está a propósito: el formato se fija al crear la división. Zod
  // descarta las claves que no declara, así que enviarlo no cambia nada.
}).superRefine((data, ctx) => assertUniqueCourts(data.horariosPorCancha, ctx));

export type CreateDivisionInput = z.output<typeof createDivisionSchema>;
export type UpdateDivisionInput = z.output<typeof updateDivisionSchema>;
