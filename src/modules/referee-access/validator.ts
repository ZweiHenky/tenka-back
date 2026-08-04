import { z } from 'zod'
import { allocationSchema } from '../partido/validator'

export const refereeResultSchema = z.object({
  expectedVersion: z.number().int().min(0),
  golesLocal: z.number().int().min(0).max(99),
  golesVisitante: z.number().int().min(0).max(99),
  penalesLocal: z.number().int().min(0).max(99).optional().nullable(),
  penalesVisitante: z.number().int().min(0).max(99).optional().nullable(),
  estado: z.literal('FINALIZADO'),
  allocations: z.array(allocationSchema).max(198),
}).strict()

export type RefereeResultInput = z.output<typeof refereeResultSchema>
