import { z } from 'zod';
import { billingWebhookIdempotencyKeySchema } from './adminWebhookValidator';

export const billingCheckoutStartBodySchema = z.object({
  purchaseSelectionId: z.string().trim().min(1).max(255),
  expectedVersion: z.number().int().min(1),
  store: z.literal('GOOGLE'),
}).strict();

export const billingCheckoutAttemptParamsSchema = z.object({
  attemptId: z.string().trim().min(1).max(255),
}).strict();

export const billingCheckoutOutcomeBodySchema = z.object({
  outcome: z.enum([
    'SDK_CONFIRMED',
    'PENDING',
    'CANCELED',
    'ALREADY_PURCHASED',
    'OWNERSHIP_CONFLICT',
    'CONFIRMATION_AMBIGUOUS',
  ]),
}).strict();

export const billingSyncBodySchema = z.object({
  checkoutAttemptId: z.string().trim().min(1).max(255).optional(),
}).strict();

export const billingCheckoutAbandonBodySchema = z.object({
  expectedVersion: z.number().int().min(1).max(2_147_483_647),
}).strict();

export const billingCheckoutIdempotencyKeySchema = billingWebhookIdempotencyKeySchema;

export type BillingCheckoutStartInput = z.output<typeof billingCheckoutStartBodySchema>;
export type BillingCheckoutOutcomeInput = z.output<typeof billingCheckoutOutcomeBodySchema>;
export type BillingCheckoutAbandonInput = z.output<typeof billingCheckoutAbandonBodySchema>;
