import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../utils/errors';
import { billingEnvironmentForApp, getActiveBillingCatalog } from './catalog';
import {
  normalizeGoogleSubscriptions,
  type BillingProviderIssue,
  type BillingProviderIssueCode,
} from './providerNormalizer';
import { persistNormalizedGoogleLedger } from './providerLedger';
import { persistLedgerAndMaterializeStoreAccess } from './effectiveAccessMaterializer';
import { getRevenueCatCustomer, RevenueCatProviderError } from './revenueCatClient';
import { observePaidAccessShadow } from './paidAccessShadow';

type AppEnvironment = typeof env.APP_ENV;
type LedgerResult = Awaited<ReturnType<typeof persistNormalizedGoogleLedger>>;

export interface BillingReconciliationIssueSummary {
  code: BillingProviderIssueCode;
  severity: BillingProviderIssue['severity'];
  count: number;
}

export interface BillingReconciliationResult {
  subscriptionsObserved: number;
  subscriptionsPersisted: number;
  transactionsCreated: number;
  periodsCreated: number;
  issues: BillingReconciliationIssueSummary[];
}

export interface BillingReconciliationDependencies {
  appEnvironment?: AppEnvironment;
  getCatalog?: typeof getActiveBillingCatalog;
  getCustomer?: typeof getRevenueCatCustomer;
  persistLedger?: typeof persistNormalizedGoogleLedger;
  observePaidAccess?: typeof observePaidAccessShadow;
}

function summarizeIssues(issues: BillingProviderIssue[]): BillingReconciliationIssueSummary[] {
  const counts = new Map<string, BillingReconciliationIssueSummary>();
  for (const issue of issues) {
    const key = `${issue.severity}:${issue.code}`;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { code: issue.code, severity: issue.severity, count: 1 });
  }
  return [...counts.values()].sort((a, b) =>
    a.severity.localeCompare(b.severity) || a.code.localeCompare(b.code));
}

function completionResult(
  subscriptionsObserved: number,
  persisted: LedgerResult,
  issues: BillingProviderIssue[],
): BillingReconciliationResult {
  return {
    subscriptionsObserved,
    subscriptionsPersisted: persisted.subscriptions,
    transactionsCreated: persisted.transactionsCreated,
    periodsCreated: persisted.periodsCreated,
    issues: summarizeIssues(issues),
  };
}

export async function reconcileRevenueCatGoogleLedger(
  billingAccountId: string,
  dependencies: BillingReconciliationDependencies = {},
): Promise<BillingReconciliationResult> {
  const startedAt = Date.now();
  const appEnvironment = dependencies.appEnvironment ?? env.APP_ENV;
  const getCatalog = dependencies.getCatalog ?? getActiveBillingCatalog;
  const getCustomer = dependencies.getCustomer ?? getRevenueCatCustomer;
  const persistLedger = dependencies.persistLedger
    ?? (env.BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED
      ? persistLedgerAndMaterializeStoreAccess
      : persistNormalizedGoogleLedger);

  try {
    const catalogEnvironment = billingEnvironmentForApp(appEnvironment);
    const catalog = await getCatalog(catalogEnvironment);
    if (!catalog.available || !catalog.release) {
      throw new AppError(
        503,
        'El catálogo de billing no está disponible',
        'BILLING_CATALOG_UNAVAILABLE',
      );
    }

    const snapshot = await getCustomer(billingAccountId);
    const normalized = normalizeGoogleSubscriptions({
      snapshot,
      expectedBillingAccountId: billingAccountId,
      catalogProducts: catalog.release.products,
      expectedStoreEnvironment: appEnvironment === 'production' ? 'PRODUCTION' : 'SANDBOX',
    });
    const persisted = await persistLedger(billingAccountId, normalized);
    if (env.BILLING_PAID_ACCESS_SHADOW_ENABLED) {
      await (dependencies.observePaidAccess ?? observePaidAccessShadow)(billingAccountId);
    }
    const result = completionResult(snapshot.subscriptions.length, persisted, normalized.issues);

    logger.info({
      provider: 'revenuecat',
      operation: 'reconcile_google_ledger',
      durationMs: Date.now() - startedAt,
      subscriptionsObserved: result.subscriptionsObserved,
      subscriptionsPersisted: result.subscriptionsPersisted,
      transactionsCreated: result.transactionsCreated,
      periodsCreated: result.periodsCreated,
      issues: result.issues,
    }, 'Billing reconciliation completed');
    return result;
  } catch (cause) {
    if (cause instanceof RevenueCatProviderError) {
      logger.warn({
        provider: 'revenuecat',
        operation: 'reconcile_google_ledger',
        durationMs: Date.now() - startedAt,
        errorCode: cause.code,
        retryable: cause.retryable,
        status: cause.status,
        retryAfterMs: cause.retryAfterMs,
      }, 'Billing reconciliation failed');
      throw cause;
    }
    if (cause instanceof AppError) {
      logger.warn({
        provider: 'revenuecat',
        operation: 'reconcile_google_ledger',
        durationMs: Date.now() - startedAt,
        errorCode: cause.code ?? 'billing_error',
        status: cause.statusCode,
      }, 'Billing reconciliation failed');
      throw cause;
    }

    const error = new AppError(
      503,
      'No fue posible reconciliar billing',
      'BILLING_RECONCILIATION_FAILED',
    );
    logger.error({
      provider: 'revenuecat',
      operation: 'reconcile_google_ledger',
      durationMs: Date.now() - startedAt,
      errorCode: error.code,
      status: error.statusCode,
      causeType: cause instanceof Error ? cause.name : typeof cause,
      causeCode: typeof cause === 'object' && cause !== null && 'code' in cause
        ? String(cause.code)
        : undefined,
    }, 'Billing reconciliation failed');
    throw error;
  }
}

export const billingReconciliationInternals = { summarizeIssues };
