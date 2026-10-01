import { createProductionBillingPrismaClient } from '../src/utils/productionDatabase';
import {
  formatBillingMigrationPreparationResult,
  prepareBillingMigrationCohortForProduction,
} from '../src/modules/billing/migrationPreparation';

const ACCOUNT_OPTION = '--billing-account-id=';
const CONFIRMATIONS = new Set([
  '--confirm=billing-migration-preparation',
  '--confirm=production',
  '--confirm-snapshot',
]);

function cohortFromArguments(args: string[]): string[] {
  const accountOptions = args.filter((argument) => argument.startsWith(ACCOUNT_OPTION));
  const validConfirmations = [...CONFIRMATIONS].every(
    (confirmation) => args.filter((argument) => argument === confirmation).length === 1,
  );
  if (!validConfirmations || args.length !== accountOptions.length + CONFIRMATIONS.size) {
    throw new Error('Invalid protected production billing migration preparation invocation');
  }
  const cohort = accountOptions.map((argument) => argument.slice(ACCOUNT_OPTION.length));
  if (cohort.length < 1 || cohort.length > 10 || new Set(cohort).size !== cohort.length
    || cohort.some((id) => !/^billing_[A-Za-z0-9_-]{8,100}$/.test(id))) {
    throw new Error('Invalid approved production billing migration cohort');
  }
  return cohort;
}

async function main(): Promise<void> {
  const cohort = cohortFromArguments(process.argv.slice(2));
  const prisma = createProductionBillingPrismaClient();
  try {
    const result = await prepareBillingMigrationCohortForProduction(cohort, prisma);
    console.log(formatBillingMigrationPreparationResult(result));
    if (result.blocked > 0) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error('Production billing migration preparation failed: code=BILLING_MIGRATION_PREPARATION_FAILED.');
  process.exitCode = 1;
});
