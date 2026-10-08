import { z } from 'zod';
import { billingWebhookIdempotencyKeySchema } from './adminWebhookValidator';

export const billingChangePreviewBodySchema = z.object({
  logicalProductId: z.string().trim().min(1).max(64),
  billingInterval: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL']),
}).strict();

export const billingChangeOperationParamsSchema = z.object({
  operationId: z.string().trim().min(1).max(64),
}).strict();

export const billingChangeConfirmBodySchema = z.object({
  targetVariantId: z.string().trim().min(1).max(255),
  expectedSourceVariantId: z.string().trim().min(1).max(255),
  previewFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export const billingChangeFinalStepConfirmBodySchema = z.object({
  expectedVersion: z.number().int().min(1).max(2_147_483_647),
}).strict();

export const billingChangeIdempotencyKeySchema = billingWebhookIdempotencyKeySchema;

export type BillingChangePreviewBody = z.output<typeof billingChangePreviewBodySchema>;
export type BillingChangeOperationParams = z.output<typeof billingChangeOperationParamsSchema>;
export type BillingChangeConfirmBody = z.output<typeof billingChangeConfirmBodySchema>;
export type BillingChangeFinalStepConfirmBody = z.output<typeof billingChangeFinalStepConfirmBodySchema>;
