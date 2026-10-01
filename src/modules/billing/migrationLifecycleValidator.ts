import { z } from 'zod';

export const billingMigrationActivationParamsSchema = z.object({
  billingAccountId: z.string().trim().min(1),
}).strict();

export const billingMigrationActivationBodySchema = z.object({
  reason: z.string().trim().min(10).max(500),
}).strict();

export const billingMigrationSelectionBodySchema = z.object({
  divisionId: z.string().trim().min(1),
}).strict();
