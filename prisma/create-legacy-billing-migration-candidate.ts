import {
  createLegacyBillingMigrationCandidateFixture,
  LegacyMigrationFixtureError,
} from '../src/modules/billing/migrationDevelopmentFixture';
import { createDevelopmentPrismaClient } from '../src/utils/developmentDatabase';

const ACCOUNT_OPTION = '--billing-account-id=';
const CONFIRMATION = '--confirm=create-legacy-billing-migration-candidate';

function accountFromArguments(args: string[]): string {
  const accountOptions = args.filter((argument) => argument.startsWith(ACCOUNT_OPTION));
  if (args.length !== 2 || accountOptions.length !== 1 || !args.includes(CONFIRMATION)) {
    throw new Error('Invalid protected legacy migration fixture invocation');
  }
  const accountId = accountOptions[0].slice(ACCOUNT_OPTION.length);
  if (!/^billing_[A-Za-z0-9_-]{8,100}$/.test(accountId)) {
    throw new Error('Invalid canonical billing account ID');
  }
  return accountId;
}

async function main(): Promise<void> {
  const billingAccountId = accountFromArguments(process.argv.slice(2));
  const prisma = createDevelopmentPrismaClient();
  try {
    const result = await createLegacyBillingMigrationCandidateFixture(billingAccountId, prisma);
    console.log(`Legacy billing migration fixture: created=${result.created} divisionCount=${result.divisionCount}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const code = error instanceof LegacyMigrationFixtureError
    ? error.code
    : typeof (error as { code?: unknown })?.code === 'string'
      ? `DATABASE_${(error as { code: string }).code}`
      : 'UNEXPECTED';
  console.error(`Legacy billing migration fixture failed: code=${code}.`);
  process.exitCode = 1;
});
