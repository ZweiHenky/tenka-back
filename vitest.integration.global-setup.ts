import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import {
  getIntegrationDatabaseUrl,
  getIntegrationPgConnectionString,
  INTEGRATION_SCHEMA,
} from './src/test/integration/database';

const resetSchemaSql = `
  DROP SCHEMA IF EXISTS "${INTEGRATION_SCHEMA}" CASCADE;
  CREATE SCHEMA "${INTEGRATION_SCHEMA}";
`;
const dropSchemaSql = `DROP SCHEMA IF EXISTS "${INTEGRATION_SCHEMA}" CASCADE;`;

async function executeSchemaSql(sql: string): Promise<void> {
  const pool = new Pool({ connectionString: getIntegrationPgConnectionString(), max: 1 });
  try {
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

async function assertRequiredExtensionsExist(): Promise<void> {
  const pool = new Pool({ connectionString: getIntegrationPgConnectionString(), max: 1 });
  try {
    const result = await pool.query<{ installed: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') AS installed`,
    );
    if (!result.rows[0].installed) {
      throw new Error(
        'The test database must have btree_gist preinstalled; the harness will not create database-wide extensions',
      );
    }
  } finally {
    await pool.end();
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  // Validate before opening a connection or executing any DDL.
  getIntegrationDatabaseUrl();
  await assertRequiredExtensionsExist();
  await executeSchemaSql(resetSchemaSql);

  const migration = spawnSync(
    process.execPath,
    [
      require.resolve('prisma/build/index.js'),
      'migrate',
      'deploy',
      '--config',
      'prisma.integration.config.ts',
    ],
    { cwd: process.cwd(), env: process.env, stdio: 'inherit' },
  );

  if (migration.status !== 0) {
    await executeSchemaSql(dropSchemaSql);
    const reason = migration.error?.message ?? `exit code ${migration.status}`;
    throw new Error(`Integration database migration failed: ${reason}`);
  }

  return async () => {
    await executeSchemaSql(dropSchemaSql);
  };
}
