import { z } from 'zod';

export const idempotencyKeySchema = z.string().trim().min(8, 'Idempotency-Key es obligatorio').max(128, 'Idempotency-Key es demasiado largo');

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD').refine((value) => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}, 'La fecha no es válida');

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'La hora debe tener formato HH:mm');
const idSchema = z.string().trim().min(1, 'El identificador es obligatorio');

const generateSlotSchema = z.object({
  fecha: dateSchema,
  horaInicio: timeSchema,
  horaFin: timeSchema,
  equipoLocalId: idSchema.optional(),
  equipoVisitanteId: idSchema.optional(),
  tipo: z.enum(['regular', 'complemento', 'amistoso', 'eliminatoria']).optional(),
  canchaId: idSchema.nullable().optional(),
  partidoId: idSchema.optional(),
}).strict();

export const generateNextSchema = z.object({
  slots: z.array(generateSlotSchema).optional(),
  equipoIds: z.array(idSchema).min(2).refine((ids) => new Set(ids).size === ids.length, 'Los equipos no pueden repetirse').optional(),
  descansoEquipoId: idSchema.optional(),
}).strict();

export type GenerateNextInput = z.output<typeof generateNextSchema>;
