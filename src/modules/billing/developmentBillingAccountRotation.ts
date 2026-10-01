import type { PrismaClient } from '../../generated/prisma/client';
import { assertDevelopmentScriptContext } from '../../utils/developmentDatabase';
import { configureRawQuerySchema } from '../../utils/rawDatabaseSchema';
import {
  acquireBillingAccountLock,
  acquireBillingOwnerBootstrapLock,
  detachBillingAccount,
  ensureBillingAccount,
} from './service';

export async function rotateCleanDevelopmentBillingAccount(
  billingAccountId: string,
  client: PrismaClient,
): Promise<{ billingAccountId: string }> {
  assertDevelopmentScriptContext();
  if (!/^billing_[A-Za-z0-9_-]{8,100}$/.test(billingAccountId)) {
    throw new Error('A canonical billing account ID is required');
  }
  return client.$transaction(async (tx) => {
    await configureRawQuerySchema(tx);
    const initial = await tx.billingAccount.findUnique({
      where: { id: billingAccountId },
      select: { userId: true },
    });
    if (!initial?.userId) throw new Error('The billing account is missing or detached');
    await acquireBillingOwnerBootstrapLock(tx, initial.userId);
    await acquireBillingAccountLock(tx, billingAccountId);
    await tx.$queryRaw`SELECT "id" FROM billing_accounts WHERE "id" = ${billingAccountId} FOR UPDATE`;
    const account = await tx.billingAccount.findUnique({
      where: { id: billingAccountId },
      select: {
        userId: true,
        migrationAccess: { select: { id: true } },
        user: { select: { rol: true, ligas: { select: { id: true } } } },
      },
    });
    if (!account?.userId || !account.user) throw new Error('The billing account changed concurrently');
    if (account.user.rol !== 'LIGA') throw new Error('The billing account owner must have role LIGA');
    if (account.user.ligas.length > 0) throw new Error('The billing account owner already has functional league data');
    if (account.migrationAccess) throw new Error('The billing account already has migration history');

    const userId = account.userId;
    await detachBillingAccount(tx, userId, 'DEVELOPMENT_FIXTURE_ROTATION');
    const replacement = await ensureBillingAccount(tx, userId);
    if (replacement.id === billingAccountId) throw new Error('Billing account rotation did not create a replacement');
    return { billingAccountId: replacement.id };
  }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 30_000 });
}
