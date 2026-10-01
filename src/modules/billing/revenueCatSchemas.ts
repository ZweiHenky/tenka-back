import { z } from 'zod';

const providerIdentifier = z.union([z.string().min(1), z.number().finite()])
  .transform((value) => String(value));
const epochMilliseconds = z.number().int().nonnegative();

const entitlementSchema = z.object({
  state: z.string().min(1),
  lookup_key: z.string().min(1),
});

const productSchema = z.object({
  id: z.string().min(1),
  store_identifier: z.string().min(1),
});

export const revenueCatSubscriptionSchema = z.object({
  id: z.string().min(1),
  customer_id: z.string().min(1),
  original_customer_id: z.string().min(1),
  product_id: z.string().min(1).nullable(),
  starts_at: epochMilliseconds,
  current_period_starts_at: epochMilliseconds,
  current_period_ends_at: epochMilliseconds.nullable(),
  ends_at: epochMilliseconds.nullable(),
  gives_access: z.boolean(),
  pending_payment: z.boolean(),
  auto_renewal_status: z.string().min(1),
  status: z.string().min(1),
  expiration_reason: z.string().min(1).nullable().optional(),
  entitlements: z.object({
    items: z.array(entitlementSchema),
    next_page: z.string().nullable(),
  }),
  environment: z.string().min(1),
  store: z.string().min(1),
  store_subscription_identifier: providerIdentifier,
  ownership: z.string().min(1),
  pending_changes: z.object({
    product: productSchema.nullable().optional(),
  }).nullable().optional(),
});

export const revenueCatSubscriptionListSchema = z.object({
  items: z.array(revenueCatSubscriptionSchema),
  next_page: z.string().nullable(),
});

export const revenueCatEntitlementListSchema = z.object({
  items: z.array(entitlementSchema),
  next_page: z.string().nullable(),
});

export const revenueCatTransactionSchema = z.object({
  id: providerIdentifier,
  purchased_at: epochMilliseconds,
  product_store_identifier: z.string().min(1),
  expiration_date: epochMilliseconds.nullable(),
  effective_expiration_date: epochMilliseconds.nullable(),
});

export const revenueCatTransactionListSchema = z.object({
  items: z.array(revenueCatTransactionSchema),
  next_page: z.string().nullable(),
});

export interface RevenueCatTransactionSnapshot {
  id: string;
  purchasedAtMs: number;
  productStoreIdentifier: string;
  expirationDateMs: number | null;
  effectiveExpirationDateMs: number | null;
}

export interface RevenueCatSubscriptionSnapshot {
  id: string;
  customerId: string;
  originalCustomerId: string;
  productId: string | null;
  startsAtMs: number;
  currentPeriodStartsAtMs: number;
  currentPeriodEndsAtMs: number | null;
  endsAtMs: number | null;
  givesAccess: boolean;
  pendingPayment: boolean;
  autoRenewalStatus: string;
  status: string;
  expirationReason: string | null;
  entitlements: Array<{ lookupKey: string; state: string }>;
  entitlementPageIncomplete: boolean;
  environment: string;
  store: string;
  storeSubscriptionIdentifier: string;
  ownership: string;
  pendingProductStoreIdentifier: string | null;
  transactions: RevenueCatTransactionSnapshot[];
}

export interface RevenueCatCustomerSnapshot {
  customerId: string;
  storeEnvironment: 'sandbox' | 'production';
  observedAt: string;
  subscriptions: RevenueCatSubscriptionSnapshot[];
}

export function toRevenueCatSubscriptionSnapshot(
  subscription: z.output<typeof revenueCatSubscriptionSchema>,
  transactions: Array<z.output<typeof revenueCatTransactionSchema>>,
): RevenueCatSubscriptionSnapshot {
  return {
    id: subscription.id,
    customerId: subscription.customer_id,
    originalCustomerId: subscription.original_customer_id,
    productId: subscription.product_id,
    startsAtMs: subscription.starts_at,
    currentPeriodStartsAtMs: subscription.current_period_starts_at,
    currentPeriodEndsAtMs: subscription.current_period_ends_at,
    endsAtMs: subscription.ends_at,
    givesAccess: subscription.gives_access,
    pendingPayment: subscription.pending_payment,
    autoRenewalStatus: subscription.auto_renewal_status,
    status: subscription.status,
    expirationReason: subscription.expiration_reason ?? null,
    entitlements: subscription.entitlements.items.map(({ lookup_key: lookupKey, state }) => ({ lookupKey, state })),
    entitlementPageIncomplete: subscription.entitlements.next_page !== null,
    environment: subscription.environment,
    store: subscription.store,
    storeSubscriptionIdentifier: subscription.store_subscription_identifier,
    ownership: subscription.ownership,
    pendingProductStoreIdentifier: subscription.pending_changes?.product?.store_identifier ?? null,
    transactions: transactions.map((transaction) => ({
      id: transaction.id,
      purchasedAtMs: transaction.purchased_at,
      productStoreIdentifier: transaction.product_store_identifier,
      expirationDateMs: transaction.expiration_date,
      effectiveExpirationDateMs: transaction.effective_expiration_date,
    })),
  };
}
