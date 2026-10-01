import { rotateCleanDevelopmentBillingAccount } from '../src/modules/billing/developmentBillingAccountRotation';
import { createDevelopmentPrismaClient } from '../src/utils/developmentDatabase';

const ACCOUNT_OPTION = '--billing-account-id=';
const CONFIRMATION = '--confirm=rotate-development-billing-account';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const accountOptions = args.filter((argument) => argument.startsWith(ACCOUNT_OPTION));
  if (args.length !== 2 || accountOptions.length !== 1 || !args.includes(CONFIRMATION)) {
    throw new Error('Invalid protected development billing account rotation invocation');
  }
  const billingAccountId = accountOptions[0].slice(ACCOUNT_OPTION.length);
  const prisma = createDevelopmentPrismaClient();
  try {
    const result = await rotateCleanDevelopmentBillingAccount(billingAccountId, prisma);
    console.log(`Development billing account rotated: billingAccountId=${result.billingAccountId}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error('Development billing account rotation failed: code=DEVELOPMENT_BILLING_ACCOUNT_ROTATION_FAILED.');
  process.exitCode = 1;
});
