import { z } from 'zod'

export const refereeResultSchema = z.object({
  golesLocal: z.number().int().min(0).max(99),
  golesVisitante: z.number().int().min(0).max(99),
  penalesLocal: z.number().int().min(0).max(99).optional().nullable(),
  penalesVisitante: z.number().int().min(0).max(99).optional().nullable(),
  estado: z.literal('FINALIZADO'),
}).strict()

export type RefereeResultInput = z.output<typeof refereeResultSchema>
