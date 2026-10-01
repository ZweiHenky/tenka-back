import { describe, expect, it } from 'vitest';
import {
  billingMigrationActivationIdempotencyKeySchema,
  billingMigrationActivationReviewApprovalBodySchema,
  billingMigrationActivationReviewBodySchema,
  billingMigrationActivationReviewParamsSchema,
  billingMigrationReviewedActivationBodySchema,
} from './migrationActivationReviewValidator';

const reason = 'Review migration activation readiness';

describe('billing migration activation review validation', () => {
  it.each([1, 10])('accepts and normalizes a review containing %i account ids', (count) => {
    const billingAccountIds = Array.from({ length: count }, (_, index) => ` billing_account_${index + 1} `);

    expect(billingMigrationActivationReviewBodySchema.parse({
      billingAccountIds,
      reason: ` ${reason} `,
    })).toEqual({
      billingAccountIds: billingAccountIds.map((id) => id.trim()),
      reason,
    });
  });

  it.each([
    ['no account ids', []],
    ['more than ten account ids', Array.from({ length: 11 }, (_, index) => `billing_account_${index + 1}`)],
  ])('rejects %s', (_name, billingAccountIds) => {
    expect(billingMigrationActivationReviewBodySchema.safeParse({ billingAccountIds, reason }).success).toBe(false);
  });

  it('rejects duplicate account ids after normalization', () => {
    const result = billingMigrationActivationReviewBodySchema.safeParse({
      billingAccountIds: ['billing_account_1', ' billing_account_1 '], reason,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]).toMatchObject({
      path: ['billingAccountIds'], message: 'billingAccountIds contiene duplicados',
    });
  });

  it.each([
    'account_1',
    'BILLING_account_1',
    'billing_',
    'billing_account with spaces',
  ])('rejects non-canonical billing account id %s', (billingAccountId) => {
    expect(billingMigrationActivationReviewBodySchema.safeParse({
      billingAccountIds: [billingAccountId], reason,
    }).success).toBe(false);
  });

  it('normalizes review ids and rejects empty review ids', () => {
    expect(billingMigrationActivationReviewParamsSchema.parse({ reviewId: ' review-1 ' }))
      .toEqual({ reviewId: 'review-1' });
    expect(billingMigrationActivationReviewParamsSchema.safeParse({ reviewId: ' ' }).success).toBe(false);
  });

  it.each([
    ['review creation', billingMigrationActivationReviewBodySchema, { billingAccountIds: ['billing_account_1'] }],
    ['approval', billingMigrationActivationReviewApprovalBodySchema, { expectedVersion: 1 }],
    ['activation', billingMigrationReviewedActivationBodySchema, { reviewId: 'review-1' }],
  ])('requires a substantive reason for %s', (_name, schema, input) => {
    expect(schema.safeParse({ ...input, reason: 'too short' }).success).toBe(false);
    expect(schema.safeParse({ ...input, reason }).success).toBe(true);
  });

  it('normalizes approval input and requires a positive integer version', () => {
    expect(billingMigrationActivationReviewApprovalBodySchema.parse({
      expectedVersion: 2, reason: ` ${reason} `,
    })).toEqual({ expectedVersion: 2, reason });
    expect(billingMigrationActivationReviewApprovalBodySchema.safeParse({
      expectedVersion: 0, reason,
    }).success).toBe(false);
    expect(billingMigrationActivationReviewApprovalBodySchema.safeParse({
      expectedVersion: 1.5, reason,
    }).success).toBe(false);
  });

  it('normalizes reviewed activation input and requires its review id', () => {
    expect(billingMigrationReviewedActivationBodySchema.parse({
      reviewId: ' review-1 ', reason: ` ${reason} `,
    })).toEqual({ reviewId: 'review-1', reason });
    expect(billingMigrationReviewedActivationBodySchema.safeParse({ reason }).success).toBe(false);
  });

  it('accepts canonical idempotency headers and rejects missing or malformed headers', () => {
    expect(billingMigrationActivationIdempotencyKeySchema.parse(' review:create-1 ')).toBe('review:create-1');
    expect(billingMigrationActivationIdempotencyKeySchema.safeParse(undefined).success).toBe(false);
    expect(billingMigrationActivationIdempotencyKeySchema.safeParse('short').success).toBe(false);
    expect(billingMigrationActivationIdempotencyKeySchema.safeParse('review key with spaces').success).toBe(false);
  });
});
