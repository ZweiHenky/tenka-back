import { prisma } from '../config/database';
import type { Prisma } from '../generated/prisma/client';

export function runInTransaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if (typeof prisma.$transaction === 'function') return prisma.$transaction(callback);
  // Repository unit tests use a lightweight Prisma mock without $transaction.
  return callback(prisma as unknown as Prisma.TransactionClient);
}
