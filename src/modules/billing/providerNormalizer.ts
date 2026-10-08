import type { BillingCatalogProductInput, BillingIntervalName } from './types';
import type { RevenueCatCustomerSnapshot, RevenueCatSubscriptionSnapshot } from './revenueCatSchemas';
import { billingEvidenceHash } from './providerEvidence';

export type BillingStoreEnvironmentName = 'SANDBOX' | 'PRODUCTION';
export type BillingProviderStatusName = 'ACTIVE' | 'BILLING_RETRY' | 'STORE_GRACE'
  | 'ACCOUNT_HOLD' | 'PAUSED' | 'EXPIRED' | 'REVOKED' | 'UNKNOWN';
export type BillingProviderEndReasonName = 'VOLUNTARY' | 'BILLING_FAILURE' | 'PAUSE'
  | 'REFUND' | 'REVOCATION' | 'CHARGEBACK' | 'FRAUD' | 'UNKNOWN';
export type BillingOwnershipTypeName = 'PURCHASED' | 'FAMILY_SHARED' | 'UNKNOWN';

export type BillingProviderIssueCode =
  | 'UNSUPPORTED_STORE'
  | 'ENVIRONMENT_MISMATCH'
  | 'CUSTOMER_MISMATCH'
  | 'ORIGINAL_CUSTOMER_MISMATCH'
  | 'UNKNOWN_PRODUCT'
  | 'ENTITLEMENT_MISMATCH'
  | 'UNKNOWN_ENTITLEMENT_STATE'
  | 'ENTITLEMENT_PAGE_INCOMPLETE'
  | 'UNSAFE_OWNERSHIP'
  | 'MISSING_PERIOD_DATES'
  | 'INVALID_PERIOD_RANGE'
  | 'MISSING_TRANSACTION_ID'
  | 'MULTIPLE_ACTIVE_SUBSCRIPTIONS'
  | 'CONTRADICTORY_PROVIDER_STATE'
  | 'UNKNOWN_PROVIDER_STATUS';

export interface BillingProviderIssue {
  code: BillingProviderIssueCode;
  severity: 'INFO' | 'WARNING' | 'BLOCKING';
  subscriptionId?: string;
  productIdentifier?: string;
}

export interface NormalizedGoogleTransaction {
  providerTransactionId: string;
  eventType: 'RENEWAL' | 'UNKNOWN';
  logicalProductId: string;
  storeProductId: string;
  basePlanId: string;
  capacity: number;
  billingInterval: BillingIntervalName;
  purchasedAt: Date;
}

export interface NormalizedGoogleProviderPeriod {
  providerPeriodKey: string;
  dedupeKey: string;
  providerTransactionId: string;
  logicalProductId: string;
  storeProductId: string;
  basePlanId: string;
  capacity: number;
  billingInterval: BillingIntervalName;
  providerPeriodStart: Date;
  providerPeriodEnd: Date;
  providerStatus: BillingProviderStatusName;
  entitlementActive: boolean;
  providerEndReason: BillingProviderEndReasonName | null;
  canonicalEvidenceReference: string;
}

export interface NormalizedGoogleSubscription {
  providerSubscriptionKey: string;
  providerChainReference: string;
  storeEnvironment: BillingStoreEnvironmentName;
  providerStatus: BillingProviderStatusName;
  providerStatusUpdatedAt: Date;
  entitlementActive: boolean;
  pendingPayment: boolean;
  eligibleForContinuedAccess: boolean;
  eligibleForNewAccess: boolean;
  eligibleForLocalGrace: boolean;
  providerEndReason: BillingProviderEndReasonName | null;
  canonicalEvidenceReference: string;
  providerAccessEndsAt: Date | null;
  willRenew: boolean | null;
  canceledAt: null;
  ownershipType: BillingOwnershipTypeName;
  currentProduct: BillingCatalogProductInput | null;
  pendingProduct: BillingCatalogProductInput | null;
  pendingEffectiveAt: Date | null;
  transactions: NormalizedGoogleTransaction[];
  periods: NormalizedGoogleProviderPeriod[];
}

export interface NormalizedGoogleCustomer {
  customerId: string;
  observedAt: Date;
  subscriptions: NormalizedGoogleSubscription[];
  issues: BillingProviderIssue[];
}

function dateFromMs(value: number | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function providerStatus(status: string): BillingProviderStatusName {
  switch (status) {
    case 'trialing':
    case 'active': return 'ACTIVE';
    case 'in_grace_period': return 'STORE_GRACE';
    case 'in_billing_retry': return 'BILLING_RETRY';
    case 'account_hold':
    case 'in_account_hold': return 'ACCOUNT_HOLD';
    case 'paused': return 'PAUSED';
    case 'expired': return 'EXPIRED';
    case 'revoked': return 'REVOKED';
    default: return 'UNKNOWN';
  }
}

function endReason(
  status: BillingProviderStatusName,
  expirationReason: string | null,
): BillingProviderEndReasonName | null {
  if (status === 'PAUSED') return 'PAUSE';
  if (status === 'REVOKED') return 'REVOCATION';
  if (status === 'EXPIRED' && expirationReason === 'BILLING_ERROR') return 'BILLING_FAILURE';
  if (status === 'EXPIRED' && expirationReason === 'UNSUBSCRIBE') return 'VOLUNTARY';
  if (expirationReason === 'REFUND') return 'REFUND';
  if (expirationReason === 'REVOCATION') return 'REVOCATION';
  if (expirationReason === 'CHARGEBACK') return 'CHARGEBACK';
  if (expirationReason === 'FRAUD') return 'FRAUD';
  if (status === 'EXPIRED') return 'UNKNOWN';
  if (status === 'UNKNOWN') return 'UNKNOWN';
  return null;
}

function willRenew(status: string): boolean | null {
  switch (status) {
    case 'will_renew':
    case 'has_already_renewed':
    case 'will_change_product': return true;
    case 'will_not_renew':
    case 'will_pause':
    case 'requires_price_increase_consent': return false;
    default: return null;
  }
}

function ownershipType(ownership: string): BillingOwnershipTypeName {
  switch (ownership.toLowerCase()) {
    case 'purchased': return 'PURCHASED';
    case 'family_shared': return 'FAMILY_SHARED';
    default: return 'UNKNOWN';
  }
}

function normalizeSubscription(
  subscription: RevenueCatSubscriptionSnapshot,
  products: Map<string, BillingCatalogProductInput>,
  expectedCustomerId: string,
  expectedStoreEnvironment: BillingStoreEnvironmentName,
  observedAt: Date,
  issues: BillingProviderIssue[],
): NormalizedGoogleSubscription | null {
  if (subscription.store !== 'play_store') {
    issues.push({ code: 'UNSUPPORTED_STORE', severity: 'INFO', subscriptionId: subscription.id });
    return null;
  }

  const environment = subscription.environment === 'sandbox' ? 'SANDBOX'
    : subscription.environment === 'production' ? 'PRODUCTION' : null;
  const environmentMatches = environment === expectedStoreEnvironment;
  if (!environmentMatches) {
    issues.push({ code: 'ENVIRONMENT_MISMATCH', severity: 'BLOCKING', subscriptionId: subscription.id });
  }
  if (subscription.customerId !== expectedCustomerId) {
    issues.push({ code: 'CUSTOMER_MISMATCH', severity: 'BLOCKING', subscriptionId: subscription.id });
  }
  if (subscription.originalCustomerId !== expectedCustomerId) {
    issues.push({ code: 'ORIGINAL_CUSTOMER_MISMATCH', severity: 'BLOCKING', subscriptionId: subscription.id });
  }

  const ownership = ownershipType(subscription.ownership);
  if (ownership !== 'PURCHASED') {
    issues.push({ code: 'UNSAFE_OWNERSHIP', severity: 'BLOCKING', subscriptionId: subscription.id });
  }

  const status = providerStatus(subscription.status);
  if (status === 'UNKNOWN') {
    issues.push({ code: 'UNKNOWN_PROVIDER_STATUS', severity: 'BLOCKING', subscriptionId: subscription.id });
  }
  const statusAllowsAccess = ['ACTIVE', 'BILLING_RETRY', 'STORE_GRACE', 'PAUSED'].includes(status);
  const expectedEntitlements = subscription.entitlements
    .filter(({ lookupKey }) => lookupKey === 'league_management');
  const hasEntitlement = expectedEntitlements.length > 0;
  if (!hasEntitlement && (subscription.givesAccess || statusAllowsAccess)) {
    issues.push({ code: 'ENTITLEMENT_MISMATCH', severity: 'BLOCKING', subscriptionId: subscription.id });
    if (subscription.entitlementPageIncomplete) {
      issues.push({ code: 'ENTITLEMENT_PAGE_INCOMPLETE', severity: 'BLOCKING', subscriptionId: subscription.id });
    }
  }
  const hasUnknownEntitlementState = expectedEntitlements
    .some(({ state }) => state !== 'active' && state !== 'inactive');
  if (hasUnknownEntitlementState) {
    issues.push({ code: 'UNKNOWN_ENTITLEMENT_STATE', severity: 'BLOCKING', subscriptionId: subscription.id });
  }
  const expectedEntitlementActive = expectedEntitlements.some(({ state }) => state === 'active');
  if (hasEntitlement && !hasUnknownEntitlementState
    && expectedEntitlementActive !== subscription.givesAccess) {
    issues.push({ code: 'CONTRADICTORY_PROVIDER_STATE', severity: 'BLOCKING', subscriptionId: subscription.id });
  }

  const sortedTransactions = [...subscription.transactions].sort((left, right) =>
    left.purchasedAtMs - right.purchasedAtMs || left.id.localeCompare(right.id));
  const latestTransaction = sortedTransactions.at(-1) ?? null;
  if (!latestTransaction) {
    issues.push({ code: 'MISSING_TRANSACTION_ID', severity: 'BLOCKING', subscriptionId: subscription.id });
  } else if (latestTransaction.id !== subscription.storeSubscriptionIdentifier) {
    issues.push({
      code: 'CONTRADICTORY_PROVIDER_STATE', severity: 'WARNING', subscriptionId: subscription.id,
      productIdentifier: latestTransaction.productStoreIdentifier,
    });
  }

  const currentProduct = latestTransaction ? products.get(latestTransaction.productStoreIdentifier) ?? null : null;
  if (latestTransaction && !currentProduct) {
    issues.push({
      code: 'UNKNOWN_PRODUCT', severity: 'BLOCKING', subscriptionId: subscription.id,
      productIdentifier: latestTransaction.productStoreIdentifier,
    });
  }
  const pendingProduct = subscription.pendingProductStoreIdentifier
    ? products.get(subscription.pendingProductStoreIdentifier) ?? null
    : null;
  if (subscription.pendingProductStoreIdentifier && !pendingProduct) {
    issues.push({
      code: 'UNKNOWN_PRODUCT', severity: 'BLOCKING', subscriptionId: subscription.id,
      productIdentifier: subscription.pendingProductStoreIdentifier,
    });
  }

  const entitlementActive = expectedEntitlementActive && subscription.givesAccess;
  const subscriptionEndReason = endReason(status, subscription.expirationReason);
  const canonicalEvidenceReference = billingEvidenceHash('revenuecat-v2-subscription', {
    id: subscription.id,
    customerId: subscription.customerId,
    originalCustomerId: subscription.originalCustomerId,
    environment: subscription.environment,
    store: subscription.store,
    productIdentifier: latestTransaction?.productStoreIdentifier ?? null,
    pendingProductIdentifier: subscription.pendingProductStoreIdentifier,
    pendingEffectiveAtMs: subscription.pendingProductStoreIdentifier
      ? subscription.currentPeriodEndsAtMs
      : null,
    status: subscription.status,
    expirationReason: subscription.expirationReason,
    expectedEntitlements,
    givesAccess: subscription.givesAccess,
    pendingPayment: subscription.pendingPayment,
    autoRenewalStatus: subscription.autoRenewalStatus,
    ownership: subscription.ownership,
    currentPeriodStartsAtMs: subscription.currentPeriodStartsAtMs,
    currentPeriodEndsAtMs: subscription.currentPeriodEndsAtMs,
    endsAtMs: subscription.endsAtMs,
  });

  const transactions: NormalizedGoogleTransaction[] = [];
  const periods: NormalizedGoogleProviderPeriod[] = [];
  sortedTransactions.forEach((transaction, index) => {
    const product = products.get(transaction.productStoreIdentifier);
    if (!product) return;
    const purchasedAt = dateFromMs(transaction.purchasedAtMs);
    if (!purchasedAt) return;
    transactions.push({
      providerTransactionId: transaction.id,
      eventType: index === 0 ? 'UNKNOWN' : 'RENEWAL',
      logicalProductId: product.logicalProductId,
      storeProductId: product.storeProductId,
      basePlanId: product.basePlanId!,
      capacity: product.capacity,
      billingInterval: product.billingInterval,
      purchasedAt,
    });

    const periodEnd = dateFromMs(transaction.effectiveExpirationDateMs ?? transaction.expirationDateMs);
    if (!periodEnd) {
      issues.push({
        code: 'MISSING_PERIOD_DATES', severity: 'BLOCKING', subscriptionId: subscription.id,
        productIdentifier: transaction.productStoreIdentifier,
      });
      return;
    }
    if (purchasedAt >= periodEnd) {
      issues.push({
        code: 'INVALID_PERIOD_RANGE', severity: 'BLOCKING', subscriptionId: subscription.id,
        productIdentifier: transaction.productStoreIdentifier,
      });
      return;
    }
    const isLatestTransaction = transaction.id === latestTransaction?.id;
    const periodStatus: BillingProviderStatusName = isLatestTransaction ? status : 'EXPIRED';
    const periodEntitlementActive = isLatestTransaction ? entitlementActive : false;
    const periodEndReason = isLatestTransaction ? subscriptionEndReason : null;
    const periodEvidence = {
      subscriptionId: subscription.id,
      transactionId: transaction.id,
      productIdentifier: transaction.productStoreIdentifier,
      purchasedAt: purchasedAt.toISOString(),
      periodEnd: periodEnd.toISOString(),
      status: periodStatus,
      entitlementActive: periodEntitlementActive,
      endReason: periodEndReason,
    };
    periods.push({
      providerPeriodKey: transaction.id,
      dedupeKey: billingEvidenceHash('revenuecat-v2-provider-period', periodEvidence),
      providerTransactionId: transaction.id,
      logicalProductId: product.logicalProductId,
      storeProductId: product.storeProductId,
      basePlanId: product.basePlanId!,
      capacity: product.capacity,
      billingInterval: product.billingInterval,
      providerPeriodStart: purchasedAt,
      providerPeriodEnd: periodEnd,
      providerStatus: periodStatus,
      entitlementActive: periodEntitlementActive,
      providerEndReason: periodEndReason,
      canonicalEvidenceReference: billingEvidenceHash('revenuecat-v2-period-evidence', periodEvidence),
    });
  });

  const accessEnd = latestTransaction
    ? dateFromMs(latestTransaction.effectiveExpirationDateMs ?? latestTransaction.expirationDateMs)
    : dateFromMs(subscription.endsAtMs);
  const latestHasValidPeriod = latestTransaction
    ? periods.some(({ providerTransactionId }) => providerTransactionId === latestTransaction.id)
    : false;
  const safeCanonicalSource = ownership === 'PURCHASED'
    && environmentMatches && subscription.customerId === expectedCustomerId
    && subscription.originalCustomerId === expectedCustomerId && currentProduct !== null && latestHasValidPeriod;
  const eligibleForContinuedAccess = entitlementActive && statusAllowsAccess && safeCanonicalSource;
  const eligibleForLocalGrace = !entitlementActive && safeCanonicalSource && accessEnd !== null
    && (status === 'BILLING_RETRY' || status === 'STORE_GRACE' || status === 'ACCOUNT_HOLD'
      || (status === 'EXPIRED' && subscriptionEndReason === 'BILLING_FAILURE'));
  return {
    providerSubscriptionKey: subscription.id,
    providerChainReference: `rcv2:${subscription.id}`,
    storeEnvironment: environment ?? expectedStoreEnvironment,
    providerStatus: status,
    providerStatusUpdatedAt: observedAt,
    entitlementActive,
    pendingPayment: subscription.pendingPayment,
    eligibleForContinuedAccess,
    eligibleForNewAccess: eligibleForContinuedAccess && !subscription.pendingPayment,
    eligibleForLocalGrace,
    providerEndReason: subscriptionEndReason,
    canonicalEvidenceReference,
    providerAccessEndsAt: accessEnd,
    willRenew: willRenew(subscription.autoRenewalStatus),
    canceledAt: null,
    ownershipType: ownership,
    currentProduct,
    pendingProduct,
    pendingEffectiveAt: pendingProduct ? dateFromMs(subscription.currentPeriodEndsAtMs) : null,
    transactions,
    periods,
  };
}

export function normalizeGoogleSubscriptions(input: {
  snapshot: RevenueCatCustomerSnapshot;
  expectedBillingAccountId: string;
  catalogProducts: ReadonlyArray<BillingCatalogProductInput>;
  expectedStoreEnvironment: BillingStoreEnvironmentName;
}): NormalizedGoogleCustomer {
  const observedAt = new Date(input.snapshot.observedAt);
  if (Number.isNaN(observedAt.getTime())) throw new TypeError('RevenueCat observation date is invalid');
  const products = new Map(input.catalogProducts
    .filter(({ active, store }) => active && store === 'GOOGLE')
    .map((product) => [product.revenueCatProductIdentifier, product]));
  const issues: BillingProviderIssue[] = [];
  const subscriptions = input.snapshot.subscriptions
    .map((subscription) => normalizeSubscription(
      subscription,
      products,
      input.expectedBillingAccountId,
      input.expectedStoreEnvironment,
      observedAt,
      issues,
    ))
    .filter((subscription): subscription is NormalizedGoogleSubscription => subscription !== null);

  if (subscriptions.filter(({ eligibleForNewAccess }) => eligibleForNewAccess).length > 1) {
    issues.push({ code: 'MULTIPLE_ACTIVE_SUBSCRIPTIONS', severity: 'WARNING' });
  }
  return { customerId: input.snapshot.customerId, observedAt, subscriptions, issues };
}

export const providerNormalizerInternals = { providerStatus, ownershipType, willRenew, dateFromMs };
