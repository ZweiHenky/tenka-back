import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const variableNames = [
  'TEST_DATABASE_URL', 'DEV_DATABASE_URL', 'DEV_DIRECT_DATABASE_URL',
  'DATABASE_URL', 'DIRECT_DATABASE_URL',
] as const;
const originalValues = new Map(variableNames.map((name) => [name, process.env[name]]));

async function loadDatabaseGuard() {
  vi.resetModules();
  return import('./database');
}

describe('integration database guard', () => {
  beforeEach(() => {
    for (const name of variableNames) delete process.env[name];
    process.env.DEV_DATABASE_URL = 'postgresql://user:secret@ep-development-pooler.example.com/app';
    process.env.DEV_DIRECT_DATABASE_URL = 'postgresql://user:secret@ep-development.example.com/app';
  });

  afterEach(() => {
    for (const name of variableNames) {
      const original = originalValues.get(name);
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
  });

  it('allows the development database only through the isolated integration schema', async () => {
    process.env.TEST_DATABASE_URL = 'postgresql://user:secret@ep-development.example.com/app?schema=tenka_integration';
    const { getIntegrationDatabaseUrl } = await loadDatabaseGuard();

    expect(new URL(getIntegrationDatabaseUrl()).searchParams.get('schema')).toBe('tenka_integration');
  });

  it('rejects pooled URLs and non-integration schemas', async () => {
    process.env.TEST_DATABASE_URL = 'postgresql://user:secret@ep-test-pooler.example.com/app?schema=tenka_integration';
    let guard = await loadDatabaseGuard();
    expect(() => guard.getIntegrationDatabaseUrl()).toThrow('direct connection');

    process.env.TEST_DATABASE_URL = 'postgresql://user:secret@ep-test.example.com/app?schema=public';
    guard = await loadDatabaseGuard();
    expect(() => guard.getIntegrationDatabaseUrl()).toThrow('schema must be tenka_integration');
  });

  it('recognizes pooled and direct production URLs as the same forbidden database', async () => {
    process.env.DATABASE_URL = 'postgresql://runtime:secret@ep-production-pooler.example.com/app';
    process.env.TEST_DATABASE_URL = 'postgresql://test:secret@ep-production.example.com/app?schema=tenka_integration';
    const { getIntegrationDatabaseUrl } = await loadDatabaseGuard();

    expect(() => getIntegrationDatabaseUrl()).toThrow('must not target the same database as DATABASE_URL');
  });
});
