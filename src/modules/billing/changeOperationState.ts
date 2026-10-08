import type { BillingChangeOperationStatus, PrismaClient } from '../../generated/prisma/client';
import type { BillingActiveChangeOperationDto, BillingChangeVariantDto } from './types';

export type BillingChangeNextAction =
  | 'PURCHASE_FIRST_STEP'
  | 'WAIT_FOR_FIRST_VERIFICATION'
  | 'SCHEDULE_PERIOD_CHANGE'
  | 'WAIT_FOR_SCHEDULE_VERIFICATION';

const TERMINAL_STATUSES: BillingChangeOperationStatus[] = ['COMPLETED', 'CANCELED', 'ABANDONED'];

function variantDto(product: {
  id: string;
  logicalProductId: string;
  billingInterval: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
  capacity: number;
  storeProductId: string;
}): BillingChangeVariantDto {
  return {
    variantId: product.id,
    logicalProductId: product.logicalProductId,
    billingInterval: product.billingInterval,
    capacity: product.capacity,
    storeProductId: product.storeProductId,
  };
}

export async function resolveBillingChangeOperationState(
  billingAccountId: string | null,
  client: unknown,
): Promise<{
  nextAction: BillingChangeNextAction | null;
  activeChangeOperation: BillingActiveChangeOperationDto | null;
}> {
  if (!billingAccountId || !client || typeof client !== 'object' || !('billingChangeOperation' in client)) {
    return { nextAction: null, activeChangeOperation: null };
  }

  const operation = await (client as Pick<PrismaClient, 'billingChangeOperation'>)
    .billingChangeOperation.findFirst({
      where: { billingAccountId, status: { notIn: TERMINAL_STATUSES } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        status: true,
        version: true,
        lastErrorCode: true,
        sourceVariant: {
          select: {
            id: true, logicalProductId: true, billingInterval: true,
            capacity: true, storeProductId: true,
          },
        },
        intermediateVariant: {
          select: {
            id: true, logicalProductId: true, billingInterval: true,
            capacity: true, storeProductId: true,
          },
        },
        targetVariant: {
          select: {
            id: true, logicalProductId: true, billingInterval: true,
            capacity: true, storeProductId: true,
          },
        },
        checkoutAttempts: {
          where: {
            purpose: { in: ['PRODUCT_CHANGE_FIRST_STEP', 'PRODUCT_CHANGE_FINAL_STEP'] },
            status: { notIn: ['VERIFIED', 'CANCELED', 'REJECTED', 'OWNERSHIP_CONFLICT', 'ABANDONED'] },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { id: true, status: true, purpose: true, version: true },
        },
      },
  });
  if (!operation) return { nextAction: null, activeChangeOperation: null };
  const currentVariant = ['FIRST_VERIFIED', 'SECOND_STEP_PENDING', 'SCHEDULED'].includes(operation.status)
    ? operation.intermediateVariant
    : operation.sourceVariant;

  const candidateAttempt = operation.checkoutAttempts?.[0] ?? null;
  const activeAttempt = candidateAttempt?.purpose === 'PRODUCT_CHANGE_FIRST_STEP'
    || candidateAttempt?.purpose === 'PRODUCT_CHANGE_FINAL_STEP' ? candidateAttempt : null;
  const nextAction: BillingChangeNextAction | null = operation.status === 'DRAFT'
    ? 'PURCHASE_FIRST_STEP'
    : ['FIRST_PURCHASE_PENDING', 'FIRST_VERIFICATION_PENDING', 'FIRST_VERIFIED'].includes(operation.status)
      ? 'WAIT_FOR_FIRST_VERIFICATION'
      : operation.status === 'SECOND_STEP_PENDING'
        ? operation.lastErrorCode === 'canonical_unsafe_ownership'
          ? null
          : activeAttempt?.purpose === 'PRODUCT_CHANGE_FINAL_STEP'
          ? 'WAIT_FOR_SCHEDULE_VERIFICATION'
          : 'SCHEDULE_PERIOD_CHANGE'
        : operation.status === 'SCHEDULED' ? 'WAIT_FOR_SCHEDULE_VERIFICATION' : null;
  return {
    nextAction,
    activeChangeOperation: {
      id: operation.id,
      status: operation.status,
      version: operation.version,
      lastErrorCode: operation.lastErrorCode,
      current: variantDto(currentVariant),
      firstStep: variantDto(operation.intermediateVariant),
      target: variantDto(operation.targetVariant),
      direction: 'UPGRADE',
      timing: 'TWO_STEP',
      requiresRenewalSelection: false,
      activeAttempt: activeAttempt ? {
        id: activeAttempt.id, status: activeAttempt.status,
        purpose: activeAttempt.purpose === 'PRODUCT_CHANGE_FIRST_STEP'
          ? 'PRODUCT_CHANGE_FIRST_STEP' : 'PRODUCT_CHANGE_FINAL_STEP',
        version: activeAttempt.version,
      } : null,
    },
  };
}

export async function resolveBillingChangeNextAction(
  billingAccountId: string | null,
  client: unknown,
): Promise<BillingChangeNextAction | null> {
  return (await resolveBillingChangeOperationState(billingAccountId, client)).nextAction;
}
