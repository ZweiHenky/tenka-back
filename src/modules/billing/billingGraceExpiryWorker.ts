import { prisma } from '../../config/database';
import type { PrismaClient } from '../../generated/prisma/client';
import { expireLocalGraceInTransaction } from './localGraceService';
import { acquireBillingAccountLock } from './service';

const BATCH_SIZE = 25;

export async function processBillingGraceExpirations(client: PrismaClient = prisma) {
  let processedCount = 0;
  for (let index = 0; index < BATCH_SIZE; index += 1) {
    const candidate = await client.billingLocalGrace.findFirst({
      where: { status: 'ACTIVE', endsAt: { lte: new Date() } },
      orderBy: [{ endsAt: 'asc' }, { id: 'asc' }],
      select: { id: true, billingAccountId: true },
    });
    if (!candidate) break;

    const processed = await client.$transaction(async (tx) => {
      await acquireBillingAccountLock(tx, candidate.billingAccountId);
      const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
      return expireLocalGraceInTransaction(tx, {
        graceId: candidate.id,
        now,
        createFreeGrant: true,
      });
    }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 15_000 });
    if (processed) processedCount += 1;
  }

  const next = await client.billingLocalGrace.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: [{ endsAt: 'asc' }, { id: 'asc' }],
    select: { endsAt: true },
  });
  return { processedCount, nextDueAt: next?.endsAt ?? null };
}
