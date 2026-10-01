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

// Migrations that cannot run against a schema other than `public` and are a
// no-op on a freshly created schema, so they are recorded as applied instead of
// executed.
//
// 20260813233356_league_timezone_and_instant guards its statement with a
// hardcoded `table_schema = 'public'` lookup while the ALTER itself resolves
// through search_path. When the database's public schema already holds the
// application tables, the guard is true for public while the ALTER targets
// INTEGRATION_SCHEMA, where "ubicaciones"."timeZone" does not exist yet — the
// column is only added later, by 20260814120000_league_timezone_and_instants.
// The file is already applied in production, so its contents (and therefore its
// checksum) must not change. Baselining is equivalent to running it here: the
// schema is created empty immediately above, so the guarded ALTER has nothing
// to do, and the default it was meant to drop is dropped unconditionally by
// 20260814130000_drop_ubicacion_timezone_default.
const BASELINED_MIGRATIONS = ['20260813233356_league_timezone_and_instant'];

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

async function assertIntegrationSearchPath(): Promise<void> {
  const pool = new Pool({ connectionString: getIntegrationPgConnectionString(), max: 1 });
  try {
    const result = await pool.query<{ searchPath: string }>(`SELECT current_setting('search_path') AS "searchPath"`);
    if (result.rows[0]?.searchPath !== INTEGRATION_SCHEMA) {
      throw new Error(`Integration connection search_path must be ${INTEGRATION_SCHEMA}`);
    }
  } finally {
    await pool.end();
  }
}

function runPrisma(args: string[]): { ok: boolean; reason: string } {
  const result = spawnSync(
    process.execPath,
    [require.resolve('prisma/build/index.js'), ...args, '--config', 'prisma.integration.config.ts'],
    { cwd: process.cwd(), env: process.env, stdio: 'inherit' },
  );

  if (result.status === 0) return { ok: true, reason: '' };
  return { ok: false, reason: result.error?.message ?? `exit code ${result.status}` };
}

export default async function setup(): Promise<() => Promise<void>> {
  // Validate before opening a connection or executing any DDL.
  getIntegrationDatabaseUrl();
  await assertRequiredExtensionsExist();
  await assertIntegrationSearchPath();
  await executeSchemaSql(resetSchemaSql);

  const steps = [
    ...BASELINED_MIGRATIONS.map((name) => ['migrate', 'resolve', '--applied', name]),
    ['migrate', 'deploy'],
  ];

  for (const step of steps) {
    const { ok, reason } = runPrisma(step);
    if (ok) continue;
    await executeSchemaSql(dropSchemaSql);
    throw new Error(`Integration database migration failed: ${reason}`);
  }

  return async () => {
    await executeSchemaSql(dropSchemaSql);
  };
}
