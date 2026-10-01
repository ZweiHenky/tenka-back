import { z } from 'zod';

const logicalProductIdSchema = z.string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/, 'logicalProductId no es válido');

const divisionIdSchema = z.string().trim().min(1).max(255);

export const billingPurchaseSelectionBodySchema = z.object({
  logicalProductId: logicalProductIdSchema,
  billingInterval: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL']),
  divisionIds: z.array(divisionIdSchema).max(15),
  expectedVersion: z.number().int().min(0),
}).strict().superRefine(({ divisionIds }, context) => {
  if (new Set(divisionIds).size !== divisionIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['divisionIds'],
      message: 'divisionIds no puede contener divisiones repetidas',
    });
  }
});

export type BillingPurchaseSelectionInput = z.output<typeof billingPurchaseSelectionBodySchema>;
