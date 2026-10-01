import { z } from 'zod';

const webhookStatuses = ['QUARANTINED', 'DEAD_LETTER'] as const;

export const billingWebhookEventParamsSchema = z.object({
  eventId: z.string().trim().min(1).max(255),
}).strict();

export const billingWebhookListQuerySchema = z.object({
  status: z.string().trim().optional().transform((value, context) => {
    if (!value) return [...webhookStatuses];
    const statuses = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
    if (statuses.length === 0 || statuses.some((item) => !webhookStatuses.includes(item as typeof webhookStatuses[number]))) {
      context.addIssue({ code: 'custom', message: 'status contiene un valor no permitido' });
      return z.NEVER;
    }
    return statuses as Array<typeof webhookStatuses[number]>;
  }),
  cursor: z.string().trim().min(1).max(255).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const billingWebhookReplayBodySchema = z.object({
  reason: z.string().trim().min(10, 'reason debe contener al menos 10 caracteres').max(500),
}).strict();

export const billingWebhookIdempotencyKeySchema = z.string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Idempotency-Key contiene caracteres no permitidos');

export type BillingWebhookListQuery = z.output<typeof billingWebhookListQuerySchema>;
