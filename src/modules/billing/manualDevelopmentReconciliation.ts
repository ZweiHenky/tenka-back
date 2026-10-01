import type { PrismaClient } from '../../generated/prisma/client';
import { env } from '../../config/env';
import { AppError } from '../../utils/errors';
import { assertDevelopmentScriptContext } from '../../utils/developmentDatabase';
import { getActiveBillingCatalog } from './catalog';
import { assertCanonicalBillingIdentity } from './canonicalIdentity';
import { schedulePeriodicReconciliationCandidate } from './periodicReconciliationWorker';
import { persistNormalizedGoogleLedger } from './providerLedger';
import { persistLedgerAndMaterializeStoreAccess } from './effectiveAccessMaterializer';
import { observePaidAccessShadow } from './paidAccessShadow';
import {
  type BillingReconciliationResult,
  reconcileRevenueCatGoogleLedger,
} from './reconciliation';
import { getRevenueCatSandboxCustomerForDevelopment } from './revenueCatClient';

interface ManualDevelopmentReconciliationDependencies {
  getCustomer?: typeof getRevenueCatSandboxCustomerForDevelopment;
  reconcile?: typeof reconcileRevenueCatGoogleLedger;
  schedule?: typeof schedulePeriodicReconciliationCandidate;
}

export async function reconcileRevenueCatSandboxForDevelopment(
  billingAccountId: string,
  client: PrismaClient,
  dependencies: ManualDevelopmentReconciliationDependencies = {},
): Promise<BillingReconciliationResult> {
  assertDevelopmentScriptContext();
  await assertCanonicalBillingIdentity(billingAccountId, client);

  const reconcile = dependencies.reconcile ?? reconcileRevenueCatGoogleLedger;
  const result = await reconcile(billingAccountId, {
    appEnvironment: 'local',
    getCatalog: (environment) => getActiveBillingCatalog(environment, client),
    getCustomer: dependencies.getCustomer ?? getRevenueCatSandboxCustomerForDevelopment,
    persistLedger: (accountId, normalized) => env.BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED
      ? persistLedgerAndMaterializeStoreAccess(accountId, normalized, client)
      : persistNormalizedGoogleLedger(accountId, normalized, client),
    observePaidAccess: (accountId) => observePaidAccessShadow(accountId, client),
  });
  if (result.subscriptionsObserved > 0 || result.subscriptionsPersisted > 0) {
    const schedule = dependencies.schedule ?? schedulePeriodicReconciliationCandidate;
    const delayMinutes = result.issues.some(({ severity }) => severity === 'BLOCKING')
      ? env.BILLING_RECONCILIATION_CRITICAL_INTERVAL_MINUTES
      : env.BILLING_RECONCILIATION_ACTIVE_INTERVAL_MINUTES;
    const periodicInProgress = await schedule(billingAccountId, delayMinutes, client);
    if (periodicInProgress) {
      throw new AppError(
        409,
        'Ya existe una reconciliacion periodica en curso',
        'BILLING_RECONCILIATION_IN_PROGRESS',
      );
    }
  }
  return result;
}

export function formatDevelopmentReconciliationResult(result: BillingReconciliationResult): string {
  const issues = result.issues.length === 0
    ? 'none'
    : result.issues.map((issue) => `${issue.severity}:${issue.code}=${issue.count}`).join(',');
  const prefix = result.issues.some(({ severity }) => severity === 'BLOCKING')
    ? 'RevenueCat sandbox reconciliation completed with blocking issues'
    : 'RevenueCat sandbox reconciliation completed';
  return `${prefix}: subscriptionsObserved=${result.subscriptionsObserved}`
    + ` subscriptionsPersisted=${result.subscriptionsPersisted}`
    + ` transactionsCreated=${result.transactionsCreated}`
    + ` periodsCreated=${result.periodsCreated}`
    + ` issues=${issues} purchasesEnabled=false.`;
}
