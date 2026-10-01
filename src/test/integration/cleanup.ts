import type { Prisma } from '../../generated/prisma/client';
import { configureRawQuerySchema } from '../../utils/rawDatabaseSchema';
import { INTEGRATION_SCHEMA } from './database';

export async function truncateIntegrationBillingData(tx: Prisma.TransactionClient): Promise<void> {
  await configureRawQuerySchema(tx);
  const [result] = await tx.$queryRaw<Array<{ schema: string }>>`SELECT current_schema() AS schema`;
  if (result?.schema !== INTEGRATION_SCHEMA) {
    throw new Error('Destructive integration cleanup requires the tenka_integration schema');
  }
  await tx.$executeRawUnsafe('TRUNCATE TABLE "billing_accounts" CASCADE');
}
