import { AppError } from '../src/utils/errors';
import { createDevelopmentPrismaClient } from '../src/utils/developmentDatabase';
import {
  formatDevelopmentReconciliationResult,
  reconcileRevenueCatSandboxForDevelopment,
} from '../src/modules/billing/manualDevelopmentReconciliation';
import { RevenueCatProviderError } from '../src/modules/billing/revenueCatClient';
import { getBillingState } from '../src/modules/billing/service';

const BILLING_ACCOUNT_OPTION = '--billing-account-id=';
const CONFIRMATION = '--confirm=revenuecat-sandbox-reconciliation';

function billingAccountIdFromArguments(args: string[]): string {
  const accountOptions = args.filter((argument) => argument.startsWith(BILLING_ACCOUNT_OPTION));
  if (args.length !== 2 || accountOptions.length !== 1 || !args.includes(CONFIRMATION)) {
    throw new Error('Invalid protected reconciliation invocation');
  }
  const billingAccountId = accountOptions[0].slice(BILLING_ACCOUNT_OPTION.length);
  if (!billingAccountId.startsWith('billing_') || billingAccountId.length > 100 || billingAccountId.includes('/')) {
    throw new Error('Invalid protected reconciliation invocation');
  }
  return billingAccountId;
}

async function main(): Promise<void> {
  const billingAccountId = billingAccountIdFromArguments(process.argv.slice(2));
  const prisma = createDevelopmentPrismaClient();
  try {
    const result = await reconcileRevenueCatSandboxForDevelopment(billingAccountId, prisma);
    console.log(formatDevelopmentReconciliationResult(result));
    const account = await prisma.billingAccount.findUniqueOrThrow({
      where: { id: billingAccountId },
      select: { userId: true },
    });
    const periods = await prisma.billingPeriod.findMany({
      where: { billingAccountId },
      select: { id: true },
    });
    const periodIds = periods.map(({ id }) => id);
    const [primarySources, materializationAudits, publicState] = await Promise.all([
      prisma.billingPeriodSource.count({
        where: { billingPeriodId: { in: periodIds }, isPrimary: true },
      }),
      prisma.billingAuditLog.count({
        where: { action: 'BILLING_PERIOD_MATERIALIZED', targetId: { in: periodIds } },
      }),
      account.userId ? getBillingState(account.userId, prisma) : null,
    ]);
    console.log(
      `Billing shadow verification: effectivePeriods=${periods.length}`
      + ` primarySources=${primarySources}`
      + ` materializationAudits=${materializationAudits}`
      + ` publicEffectiveAccess=${publicState?.effectiveAccess ?? 'DETACHED'}`
      + ` publicEffectiveCapacity=${publicState?.effectiveCapacity ?? 0}`
      + ` purchasesEnabled=${publicState?.purchasesEnabled ?? false}.`,
    );
    if (result.issues.some(({ severity }) => severity === 'BLOCKING')) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  if (error instanceof RevenueCatProviderError) {
    const details = [
      `code=${error.code}`,
      `retryable=${error.retryable}`,
      error.status === undefined ? null : `status=${error.status}`,
      error.retryAfterMs === undefined ? null : `retryAfterMs=${error.retryAfterMs}`,
    ].filter((value): value is string => value !== null).join(' ');
    console.error(`RevenueCat sandbox reconciliation failed: ${details}.`);
  } else if (error instanceof AppError) {
    console.error(`RevenueCat sandbox reconciliation failed: code=${error.code ?? 'billing_error'} status=${error.statusCode}.`);
  } else {
    console.error('RevenueCat sandbox reconciliation failed: code=BILLING_RECONCILIATION_FAILED.');
  }
  process.exitCode = 1;
});
