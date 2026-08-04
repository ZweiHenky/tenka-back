import { z } from 'zod';

const isoDateTime = z.string().datetime({ offset: true });

export const availabilityRangeSchema = z.object({
  inicio: isoDateTime,
  fin: isoDateTime,
}).superRefine(({ inicio, fin }, context) => {
  const start = new Date(inicio).getTime();
  const end = new Date(fin).getTime();
  if (end <= start) {
    context.addIssue({ code: 'custom', path: ['fin'], message: 'fin debe ser posterior a inicio' });
  } else if (end - start > 31 * 24 * 60 * 60 * 1000) {
    context.addIssue({ code: 'custom', path: ['fin'], message: 'El rango no puede exceder 31 dias' });
  }
}).transform(({ inicio, fin }) => ({ inicio: new Date(inicio), fin: new Date(fin) }));
