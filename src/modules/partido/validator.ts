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

export const createInJornadaSchema = z.object({
  equipoLocalId: z.string().min(1),
  equipoVisitanteId: z.string().min(1),
  tipoPartido: z.enum(['REGULAR', 'COMPLEMENTO']),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD').refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }, 'La fecha no es válida'),
  horaInicio: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'La hora de inicio debe tener formato HH:mm'),
  horaFin: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'La hora fin debe tener formato HH:mm'),
  canchaId: z.string().min(1).nullable().optional(),
}).strict();

export const updateSchema = z.object({
  golesLocal: z.number().int().min(0).optional(),
  golesVisitante: z.number().int().min(0).optional(),
  penalesLocal: z.number().int().min(0).nullable().optional(),
  penalesVisitante: z.number().int().min(0).nullable().optional(),
  estado: z.enum(['PROGRAMADO', 'EN_JUEGO', 'FINALIZADO', 'SUSPENDIDO']).optional(),
  llave: z.number().int().optional(),
  jornadaId: z.string().optional(),
  rondaPlayoffId: z.string().optional(),
  equipoLocalId: z.string().min(1).optional(),
  equipoVisitanteId: z.string().min(1).optional(),
  tipoPartido: z.enum(['REGULAR', 'AMISTOSO', 'COMPLEMENTO', 'ELIMINATORIA']).optional(),
  exhibicionLocal: z.boolean().optional(),
  exhibicionVisitante: z.boolean().optional(),
}).strict();

export const allocationSchema = z.object({
  ladoMarcador: z.enum(['LOCAL', 'VISITANTE']),
  jugadorId: z.string().min(1).nullable(),
  cantidad: z.number().int().positive().max(99),
}).strict();

export const participacionSchema = z.object({
  ladoMarcador: z.enum(['LOCAL', 'VISITANTE']),
  jugadorId: z.string().min(1),
}).strict();

export const notasSchema = z
  .string()
  .trim()
  .max(1000, 'Las notas no pueden superar los 1000 caracteres')
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

export const resultSchema = z.object({
  expectedVersion: z.number().int().min(0),
  estado: z.enum(['FINALIZADO', 'PROGRAMADO', 'SUSPENDIDO']),
  golesLocal: z.number().int().min(0).max(99),
  golesVisitante: z.number().int().min(0).max(99),
  penalesLocal: z.number().int().min(0).max(99).nullable().optional(),
  penalesVisitante: z.number().int().min(0).max(99).nullable().optional(),
  allocations: z.array(allocationSchema).max(198),
  participaciones: z.array(participacionSchema).max(198).optional(),
  notas: notasSchema,
}).strict();

export type CreateInput = z.output<typeof createSchema>;
export type CreateInJornadaInput = z.output<typeof createInJornadaSchema>;
export type UpdateInput = z.output<typeof updateSchema>;
export type ResultInput = z.output<typeof resultSchema>;
