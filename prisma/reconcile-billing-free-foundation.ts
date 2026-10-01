import { createDevelopmentPrismaClient } from '../src/utils/developmentDatabase';
import {
  formatFreeFoundationReconciliation,
  reconcileFreeFoundation,
} from '../src/modules/billing/freeFoundationReconciliation';

const CONFIRMATION = '--confirm=billing-free-foundation-reconciliation';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== CONFIRMATION) {
    throw new Error('Invalid protected free foundation reconciliation invocation');
  }
  const prisma = createDevelopmentPrismaClient();
  try {
    const result = await reconcileFreeFoundation(prisma);
    console.log(formatFreeFoundationReconciliation(result));
    if (result.blocked > 0) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error('Billing free foundation reconciliation failed: code=BILLING_FREE_FOUNDATION_RECONCILIATION_FAILED.');
  process.exitCode = 1;
});
