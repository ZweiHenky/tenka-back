import { prisma } from '../../config/database';
import type { PrismaClient } from '../../generated/prisma/client';
import { acquireBillingAccountLock } from './service';
import { applyExpiredBillingMigrationInTransaction, currentBillingEnvironment } from './migrationLifecycleService';

const BATCH_SIZE = 25;

export async function processBillingMigrationExpirations(client: PrismaClient = prisma) {
  const openPause = await client.billingOperationalPause.findFirst({
    where: { environment: currentBillingEnvironment(), endedAt: null }, select: { id: true },
  });
  if (openPause) return { processedCount: 0, nextDueAt: null };

  let processedCount = 0;
  for (let index = 0; index < BATCH_SIZE; index += 1) {
    const candidate = await client.billingMigrationAccess.findFirst({
      where: { status: { in: ['SELECTION_REQUIRED', 'SELECTED', 'PURCHASED'] }, deadline: { not: null } },
      orderBy: [{ deadline: 'asc' }, { id: 'asc' }],
      select: { id: true, billingAccountId: true },
    });
    if (!candidate) break;
    const processed = await client.$transaction(async (tx) => {
      await acquireBillingAccountLock(tx, candidate.billingAccountId);
      const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
      return applyExpiredBillingMigrationInTransaction(tx, { migrationId: candidate.id, now });
    }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 30_000 });
    if (processed) processedCount += 1;
    else break;
  }
  const next = await client.billingMigrationAccess.findFirst({
    where: { status: { in: ['SELECTION_REQUIRED', 'SELECTED', 'PURCHASED'] }, deadline: { not: null } },
    orderBy: [{ deadline: 'asc' }, { id: 'asc' }], select: { deadline: true },
  });
  return { processedCount, nextDueAt: next?.deadline ?? null };
}
