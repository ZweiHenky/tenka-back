import { z } from 'zod';
import { billingAdminIdempotencyKeySchema } from './operationalControlValidator';

const billingAccountIdSchema = z.string().trim().min(9).max(255).regex(/^billing_[A-Za-z0-9_-]+$/);

export const billingMigrationActivationReviewBodySchema = z.object({
  billingAccountIds: z.array(billingAccountIdSchema).min(1).max(10),
  reason: z.string().trim().min(10).max(500),
}).strict().superRefine((value, context) => {
  if (new Set(value.billingAccountIds).size !== value.billingAccountIds.length) {
    context.addIssue({ code: 'custom', path: ['billingAccountIds'], message: 'billingAccountIds contiene duplicados' });
  }
});

export const billingMigrationActivationReviewParamsSchema = z.object({
  reviewId: z.string().trim().min(1).max(255),
}).strict();

export const billingMigrationActivationReviewApprovalBodySchema = z.object({
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().min(10).max(500),
}).strict();

export const billingMigrationReviewedActivationBodySchema = z.object({
  reviewId: z.string().trim().min(1).max(255),
  reason: z.string().trim().min(10).max(500),
}).strict();

export const billingMigrationActivationIdempotencyKeySchema = billingAdminIdempotencyKeySchema;

export type BillingMigrationActivationReviewInput = z.output<typeof billingMigrationActivationReviewBodySchema>;
export type BillingMigrationActivationReviewApprovalInput = z.output<typeof billingMigrationActivationReviewApprovalBodySchema>;
