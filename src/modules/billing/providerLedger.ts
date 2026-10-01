import { prisma } from '../../config/database';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { AppError, NotFoundError } from '../../utils/errors';
import { acquireBillingAccountLock } from './service';
import type { NormalizedGoogleCustomer, NormalizedGoogleSubscription } from './providerNormalizer';

export function ownershipConflict(): AppError {
  return new AppError(
    409,
    'La compra ya pertenece a otra cuenta de billing',
    'BILLING_OWNERSHIP_CONFLICT',
  );
}

function commercialSnapshot(product: NormalizedGoogleSubscription['currentProduct'], prefix: 'current' | 'pending') {
  const empty = {
    [`${prefix}LogicalProductId`]: null,
    [`${prefix}StoreProductId`]: null,
    [`${prefix}BasePlanId`]: null,
    [`${prefix}Capacity`]: null,
    [`${prefix}BillingInterval`]: null,
  };
  if (!product) return empty;
  return {
    [`${prefix}LogicalProductId`]: product.logicalProductId,
    [`${prefix}StoreProductId`]: product.storeProductId,
    [`${prefix}BasePlanId`]: product.basePlanId,
    [`${prefix}Capacity`]: product.capacity,
    [`${prefix}BillingInterval`]: product.billingInterval,
  };
}

function sameTransaction(existing: {
  providerSubscriptionId: string | null;
  storeEnvironment: string;
  logicalProductId: string;
  storeProductId: string;
  basePlanId: string | null;
  capacity: number;
  billingInterval: string;
  purchasedAt: Date;
}, subscriptionId: string, storeEnvironment: string, transaction: NormalizedGoogleSubscription['transactions'][number]): boolean {
  return existing.providerSubscriptionId === subscriptionId
    && existing.storeEnvironment === storeEnvironment
    && existing.logicalProductId === transaction.logicalProductId
    && existing.storeProductId === transaction.storeProductId
    && existing.basePlanId === transaction.basePlanId
    && existing.capacity === transaction.capacity
    && existing.billingInterval === transaction.billingInterval
    && existing.purchasedAt.getTime() === transaction.purchasedAt.getTime();
}

export async function persistNormalizedGoogleLedger(
  billingAccountId: string,
  normalized: NormalizedGoogleCustomer,
  client: PrismaClient = prisma,
): Promise<{ subscriptions: number; transactionsCreated: number; periodsCreated: number }> {
  try {
    return await client.$transaction(async (tx) => {
      await acquireBillingAccountLock(tx, billingAccountId);
      return persistNormalizedGoogleLedgerInTransaction(billingAccountId, normalized, tx);
    }, { maxWait: 5_000, timeout: 30_000 });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if ((error as { code?: unknown })?.code === 'P2002') throw ownershipConflict();
    throw error;
  }
}

export async function persistNormalizedGoogleLedgerInTransaction(
  billingAccountId: string,
  normalized: NormalizedGoogleCustomer,
  tx: Prisma.TransactionClient,
): Promise<{ subscriptions: number; transactionsCreated: number; periodsCreated: number }> {
  const account = await tx.billingAccount.findUnique({ where: { id: billingAccountId }, select: { id: true } });
  if (!account) throw new NotFoundError('Cuenta de billing');
  if (normalized.customerId !== billingAccountId) throw ownershipConflict();
  if (normalized.issues.some(({ code }) => [
    'CUSTOMER_MISMATCH',
    'ORIGINAL_CUSTOMER_MISMATCH',
    'UNSAFE_OWNERSHIP',
  ].includes(code))) throw ownershipConflict();

  let transactionsCreated = 0;
  let periodsCreated = 0;
  for (const subscription of normalized.subscriptions) {
        const existingChain = await tx.billingProviderSubscriptionChain.findUnique({
          where: { store_providerChainReference: { store: 'GOOGLE', providerChainReference: subscription.providerChainReference } },
          select: { id: true, billingAccountId: true },
        });
        if (existingChain && existingChain.billingAccountId !== billingAccountId) throw ownershipConflict();
        const chain = existingChain ?? await tx.billingProviderSubscriptionChain.create({
          data: {
            billingAccountId,
            store: 'GOOGLE',
            providerChainReference: subscription.providerChainReference,
          },
          select: { id: true, billingAccountId: true },
        });

        const existingSubscription = await tx.billingProviderSubscription.findUnique({
          where: { store_providerSubscriptionKey: { store: 'GOOGLE', providerSubscriptionKey: subscription.providerSubscriptionKey } },
          select: {
            id: true,
            providerSubscriptionChainId: true,
            providerStatusUpdatedAt: true,
            canonicalEvidenceReference: true,
            chain: { select: { billingAccountId: true } },
          },
        });
        if (existingSubscription && existingSubscription.chain.billingAccountId !== billingAccountId) {
          throw ownershipConflict();
        }
        if (existingSubscription && existingSubscription.providerSubscriptionChainId !== chain.id) {
          throw new AppError(409, 'La suscripción ya pertenece a otra cadena', 'BILLING_CHAIN_CONFLICT');
        }
        if (existingSubscription && existingSubscription.providerStatusUpdatedAt > subscription.providerStatusUpdatedAt) {
          continue;
        }
        if (existingSubscription
          && existingSubscription.providerStatusUpdatedAt.getTime() === subscription.providerStatusUpdatedAt.getTime()
          && existingSubscription.canonicalEvidenceReference !== subscription.canonicalEvidenceReference) {
          throw new AppError(409, 'La suscripcion contradice evidencia observada al mismo instante', 'BILLING_PROVIDER_STATE_CONFLICT');
        }

        const mutableData = {
          storeEnvironment: subscription.storeEnvironment,
          providerStatus: subscription.providerStatus,
          providerStatusUpdatedAt: subscription.providerStatusUpdatedAt,
          entitlementActive: subscription.entitlementActive,
          providerEndReason: subscription.providerEndReason,
          canonicalEvidenceReference: subscription.canonicalEvidenceReference,
          providerAccessEndsAt: subscription.providerAccessEndsAt,
          willRenew: subscription.willRenew,
          canceledAt: subscription.canceledAt,
          ownershipType: subscription.ownershipType,
          ...commercialSnapshot(subscription.currentProduct, 'current'),
          ...commercialSnapshot(subscription.pendingProduct, 'pending'),
          pendingEffectiveAt: subscription.pendingProduct ? subscription.pendingEffectiveAt : null,
        };
        const storedSubscription = existingSubscription
          ? existingSubscription.providerStatusUpdatedAt <= subscription.providerStatusUpdatedAt
            ? await tx.billingProviderSubscription.update({
              where: { id: existingSubscription.id }, data: mutableData, select: { id: true },
            })
            : { id: existingSubscription.id }
          : await tx.billingProviderSubscription.create({
            data: {
              providerSubscriptionChainId: chain.id,
              store: 'GOOGLE',
              providerSubscriptionKey: subscription.providerSubscriptionKey,
              ...mutableData,
            },
            select: { id: true },
          });

        const transactionIds = new Map<string, string>();
        for (const transaction of subscription.transactions) {
          const existing = await tx.billingTransaction.findUnique({
            where: { store_providerTransactionId: { store: 'GOOGLE', providerTransactionId: transaction.providerTransactionId } },
            select: {
              id: true, billingAccountId: true, providerSubscriptionId: true, storeEnvironment: true,
              logicalProductId: true, storeProductId: true, basePlanId: true, capacity: true,
              billingInterval: true, purchasedAt: true,
            },
          });
          if (existing) {
            if (existing.billingAccountId !== billingAccountId) throw ownershipConflict();
            if (!sameTransaction(existing, storedSubscription.id, subscription.storeEnvironment, transaction)) {
              throw new AppError(409, 'La transacción contradice evidencia ya persistida', 'BILLING_TRANSACTION_CONFLICT');
            }
            transactionIds.set(transaction.providerTransactionId, existing.id);
            continue;
          }
          const created = await tx.billingTransaction.create({
            data: {
              billingAccountId,
              providerSubscriptionId: storedSubscription.id,
              store: 'GOOGLE',
              storeEnvironment: subscription.storeEnvironment,
              providerTransactionId: transaction.providerTransactionId,
              eventType: transaction.eventType,
              logicalProductId: transaction.logicalProductId,
              storeProductId: transaction.storeProductId,
              basePlanId: transaction.basePlanId,
              capacity: transaction.capacity,
              billingInterval: transaction.billingInterval,
              purchasedAt: transaction.purchasedAt,
            },
            select: { id: true },
          });
          transactionIds.set(transaction.providerTransactionId, created.id);
          transactionsCreated += 1;
        }

        for (const period of subscription.periods) {
          const duplicate = await tx.billingProviderPeriod.findUnique({
            where: {
              providerSubscriptionId_dedupeKey: {
                providerSubscriptionId: storedSubscription.id,
                dedupeKey: period.dedupeKey,
              },
            },
            select: { id: true },
          });
          if (duplicate) continue;

          const previous = await tx.billingProviderPeriod.findFirst({
            where: {
              providerSubscriptionId: storedSubscription.id,
              providerPeriodKey: period.providerPeriodKey,
            },
            orderBy: [{ revision: 'desc' }, { id: 'desc' }],
            select: { id: true, revision: true },
          });
          await tx.billingProviderPeriod.create({
            data: {
              billingAccountId,
              providerSubscriptionId: storedSubscription.id,
              billingTransactionId: transactionIds.get(period.providerTransactionId) ?? null,
              store: 'GOOGLE',
              storeEnvironment: subscription.storeEnvironment,
              providerPeriodKey: period.providerPeriodKey,
              revision: previous ? previous.revision + 1 : 1,
              supersedesProviderPeriodId: previous?.id ?? null,
              dedupeKey: period.dedupeKey,
              logicalProductId: period.logicalProductId,
              storeProductId: period.storeProductId,
              basePlanId: period.basePlanId,
              capacity: period.capacity,
              billingInterval: period.billingInterval,
              providerPeriodStart: period.providerPeriodStart,
              providerPeriodEnd: period.providerPeriodEnd,
              providerStatus: period.providerStatus,
              entitlementActive: period.entitlementActive,
              providerEndReason: period.providerEndReason,
              canonicalEvidenceReference: period.canonicalEvidenceReference,
            },
          });
          periodsCreated += 1;
        }
  }
  return { subscriptions: normalized.subscriptions.length, transactionsCreated, periodsCreated };
}

export const providerLedgerInternals = { commercialSnapshot, sameTransaction };
