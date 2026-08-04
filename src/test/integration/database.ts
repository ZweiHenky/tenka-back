import { config } from 'dotenv';
import { resolve } from 'node:path';

export const INTEGRATION_SCHEMA = 'myleague_integration';

let cachedUrl: string | undefined;

export function getIntegrationDatabaseUrl(): string {
  if (cachedUrl) return cachedUrl;

  config({ path: resolve(process.cwd(), '.env'), override: false, quiet: true });

  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for integration tests');
  }

  let parsed: URL;
  try {
    parsed = new URL(testDatabaseUrl);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid URL');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('TEST_DATABASE_URL must be a PostgreSQL URL');
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    let parsedDatabaseUrl: URL;
    try {
      parsedDatabaseUrl = new URL(databaseUrl);
    } catch {
      throw new Error('DATABASE_URL must be valid so integration-test safety can be verified');
    }

    if (parsed.href === parsedDatabaseUrl.href) {
      throw new Error('TEST_DATABASE_URL must not equal DATABASE_URL');
    }
  }

  const configuredSchemas = parsed.searchParams.getAll('schema');
  if (configuredSchemas.length > 1) {
    throw new Error('TEST_DATABASE_URL must specify at most one schema');
  }
  if (configuredSchemas[0] && configuredSchemas[0] !== INTEGRATION_SCHEMA) {
    throw new Error(`TEST_DATABASE_URL schema must be ${INTEGRATION_SCHEMA}`);
  }
  if (parsed.searchParams.has('search_path') || /search_path/i.test(parsed.searchParams.get('options') ?? '')) {
    throw new Error('TEST_DATABASE_URL must not override search_path');
  }

  if (databaseUrl) {
    const testTarget = new URL(parsed);
    const applicationTarget = new URL(databaseUrl);
    testTarget.searchParams.delete('schema');
    applicationTarget.searchParams.delete('schema');
    if (testTarget.href === applicationTarget.href) {
      throw new Error('TEST_DATABASE_URL must not target the DATABASE_URL database');
    }
  }

  parsed.searchParams.set('schema', INTEGRATION_SCHEMA);
  if (parsed.searchParams.get('schema') !== INTEGRATION_SCHEMA) {
    throw new Error(`Integration database URL must target ${INTEGRATION_SCHEMA}`);
  }

  cachedUrl = parsed.href;
  return cachedUrl;
}

export function getIntegrationPgConnectionString(): string {
  const parsed = new URL(getIntegrationDatabaseUrl());
  parsed.searchParams.delete('schema');
  return parsed.href;
}
