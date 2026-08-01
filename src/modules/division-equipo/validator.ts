import { z } from 'zod';

export const createSchema = z.object({
  divisionId: z.string().min(1),
  equipoId: z.string().min(1),
});

export const updateSchema = z.object({
  saldoPendiente: z.string()
    .regex(/^\d{1,10}(?:\.\d{1,2})?$/, 'El saldo pendiente debe ser un decimal no negativo con máximo 2 decimales')
    .transform((value) => {
      const [integer, decimal = ''] = value.split('.');
      const canonicalInteger = integer.replace(/^0+(?=\d)/, '');
      return `${canonicalInteger}.${decimal.padEnd(2, '0')}`;
    }),
}).strict();

export type CreateInput = z.output<typeof createSchema>;
export type UpdateInput = z.output<typeof updateSchema>;
