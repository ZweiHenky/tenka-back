import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const variableNames = [
  'TEST_DATABASE_URL', 'DEV_DATABASE_URL', 'DEV_DIRECT_DATABASE_URL',
  'DATABASE_URL', 'DIRECT_DATABASE_URL', 'SHADOW_DATABASE_URL',
  'PRISMA_DATABASE_URL', 'PRISMA_SHADOW_DATABASE_URL',
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

  it('allows a dedicated integration database and pins its schema and raw search path', async () => {
    process.env.TEST_DATABASE_URL = 'postgresql://user:secret@ep-integration.example.com/app?schema=tenka_integration';
    const { getIntegrationDatabaseUrl } = await loadDatabaseGuard();
    const url = new URL(getIntegrationDatabaseUrl());

    expect(url.searchParams.get('schema')).toBe('tenka_integration');
    expect(url.searchParams.get('options')).toBe('-c search_path=tenka_integration');
  });

  it('allows the shared non-production development database through the isolated schema', async () => {
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

  it('rejects the shadow database as an integration target', async () => {
    process.env.SHADOW_DATABASE_URL = 'postgresql://user:secret@ep-shadow.example.com/app';
    process.env.TEST_DATABASE_URL = 'postgresql://test:secret@ep-shadow.example.com/app?schema=tenka_integration';
    const { getIntegrationDatabaseUrl } = await loadDatabaseGuard();

    expect(() => getIntegrationDatabaseUrl()).toThrow('must not target the same database as SHADOW_DATABASE_URL');
  });

  it('canonicalizes percent-encoded database names before comparing targets', async () => {
    process.env.DATABASE_URL = 'postgresql://runtime:secret@ep-production-pooler.example.com/app';
    process.env.TEST_DATABASE_URL = 'postgresql://test:secret@ep-production.example.com/a%70p?schema=tenka_integration';
    const { getIntegrationDatabaseUrl } = await loadDatabaseGuard();

    expect(() => getIntegrationDatabaseUrl()).toThrow('must not target the same database as DATABASE_URL');
  });

  it.each(['PRISMA_DATABASE_URL', 'PRISMA_SHADOW_DATABASE_URL'] as const)(
    'rejects the ephemeral Prisma target %s when it shares the integration database',
    async (name) => {
      process.env[name] = 'postgresql://user:secret@ep-prisma.example.com/app';
      process.env.TEST_DATABASE_URL = 'postgresql://test:secret@ep-prisma.example.com/app?schema=tenka_integration';
      const { getIntegrationDatabaseUrl } = await loadDatabaseGuard();

      expect(() => getIntegrationDatabaseUrl()).toThrow(`must not target the same database as ${name}`);
    },
  );
});
