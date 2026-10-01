import { createDevelopmentPrismaClient } from '../src/utils/developmentDatabase';
import {
  formatBillingMigrationValidationResult,
  validateBillingMigrationPreparation,
} from '../src/modules/billing/migrationPreparation';

async function main(): Promise<void> {
  if (process.argv.slice(2).length !== 0) throw new Error('Invalid protected validation invocation');
  const prisma = createDevelopmentPrismaClient();
  try {
    const result = await validateBillingMigrationPreparation(prisma);
    console.log(formatBillingMigrationValidationResult(result));
    if (result.invalid > 0) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error('Billing migration validation failed: code=BILLING_MIGRATION_VALIDATION_FAILED.');
  process.exitCode = 1;
});
