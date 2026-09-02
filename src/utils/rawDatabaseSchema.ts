import type { Prisma } from '../generated/prisma/client';
import { env } from '../config/env';

export function databaseSchema(): string {
  const schema = new URL(env.DATABASE_URL).searchParams.get('schema') ?? 'public';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error('Invalid database schema');
  return schema;
}

export async function configureRawQuerySchema(tx: Prisma.TransactionClient): Promise<void> {
  // Prisma's adapter qualifies ORM queries but does not set search_path for raw SQL.
  await tx.$queryRaw`SELECT set_config('search_path', ${databaseSchema()}, true)`;
}
