import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDevelopmentPrismaClient } from '../src/utils/developmentDatabase';
import {
  formatBillingMigrationPreparationResult,
  prepareBillingMigrationCohort,
} from '../src/modules/billing/migrationPreparation';

const INPUT_OPTION = '--input=';
const CONFIRMATION = '--confirm=billing-migration-preparation';

function inputPathFromArguments(args: string[]): string {
  const inputOptions = args.filter((argument) => argument.startsWith(INPUT_OPTION));
  if (args.length !== 2 || inputOptions.length !== 1 || !args.includes(CONFIRMATION)) {
    throw new Error('Invalid protected billing migration preparation invocation');
  }
  return resolve(process.cwd(), inputOptions[0].slice(INPUT_OPTION.length));
}

function parseCohort(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !('billingAccountIds' in value)
    || !Array.isArray(value.billingAccountIds)
    || value.billingAccountIds.some((id) => typeof id !== 'string' || !/^billing_[A-Za-z0-9_-]{8,100}$/.test(id))) {
    throw new Error('Invalid approved billing migration cohort');
  }
  return value.billingAccountIds;
}

async function main(): Promise<void> {
  const inputPath = inputPathFromArguments(process.argv.slice(2));
  const cohort = parseCohort(JSON.parse(await readFile(inputPath, 'utf8')) as unknown);
  const prisma = createDevelopmentPrismaClient();
  try {
    const result = await prepareBillingMigrationCohort(cohort, prisma);
    console.log(formatBillingMigrationPreparationResult(result));
    if (result.blocked > 0) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error('Billing migration preparation failed: code=BILLING_MIGRATION_PREPARATION_FAILED.');
  process.exitCode = 1;
});
