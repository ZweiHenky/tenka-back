import { z } from 'zod';
import { billingWebhookIdempotencyKeySchema } from './adminWebhookValidator';

export const billingOperationalControlBodySchema = z.object({
  mode: z.enum(['ENABLED', 'PURCHASES_PAUSED']),
  reason: z.string().trim().min(10, 'reason debe contener al menos 10 caracteres').max(500),
  expectedVersion: z.number().int().min(1),
}).strict();

export const billingAdminIdempotencyKeySchema = billingWebhookIdempotencyKeySchema;

export type BillingOperationalControlInput = z.output<typeof billingOperationalControlBodySchema>;
