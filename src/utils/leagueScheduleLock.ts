import type { Prisma } from '../generated/prisma/client';

export async function acquireLeagueScheduleLock(tx: Prisma.TransactionClient, ligaId: string): Promise<void> {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', ligaId);
}
