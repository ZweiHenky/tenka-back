import { createDevelopmentPrismaClient } from '../src/utils/developmentDatabase';
import { auditFreeFoundation, formatFreeFoundationAudit } from '../src/modules/billing/freeFoundationReconciliation';

async function main(): Promise<void> {
  if (process.argv.slice(2).length !== 0) throw new Error('Invalid protected free foundation audit invocation');
  const prisma = createDevelopmentPrismaClient();
  try {
    console.log(formatFreeFoundationAudit(await auditFreeFoundation(prisma)));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error('Billing free foundation audit failed: code=BILLING_FREE_FOUNDATION_AUDIT_FAILED.');
  process.exitCode = 1;
});
