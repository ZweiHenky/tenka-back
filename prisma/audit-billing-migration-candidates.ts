import { createDevelopmentPrismaClient } from '../src/utils/developmentDatabase';
import {
  auditBillingMigrationCandidates,
  formatBillingMigrationCandidateAudit,
} from '../src/modules/billing/migrationPreparation';

async function main(): Promise<void> {
  if (process.argv.slice(2).length !== 0) throw new Error('Invalid protected audit invocation');
  const prisma = createDevelopmentPrismaClient();
  try {
    console.log(formatBillingMigrationCandidateAudit(await auditBillingMigrationCandidates(prisma)));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error('Billing migration candidate audit failed: code=BILLING_MIGRATION_AUDIT_FAILED.');
  process.exitCode = 1;
});
