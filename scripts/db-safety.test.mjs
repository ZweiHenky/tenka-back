import assert from 'node:assert/strict'
import test from 'node:test'
import { SAFE_PRISMA_URL, databaseIdentity, resolveDevelopmentScriptDatabase, resolvePrismaCommand } from './db-safety.mjs'

const developmentEnv = {
  APP_ENV: 'local',
  DB_TARGET: 'development',
  DEV_DATABASE_URL: 'postgresql://user:secret@ep-development-pooler.example.com/app',
  DEV_DIRECT_DATABASE_URL: 'postgresql://user:secret@ep-development.example.com/app',
  TEST_DATABASE_URL: 'postgresql://user:secret@ep-integration.example.com/app?schema=myleague_integration',
  SHADOW_DATABASE_URL: 'postgresql://user:secret@ep-shadow.example.com/app',
}

test('generate uses a non-routable safe URL', () => {
  assert.deepEqual(resolvePrismaCommand('generate'), { args: ['generate'], databaseUrl: SAFE_PRISMA_URL })
})

test('normalizes pooled and direct Neon hosts to the same identity', () => {
  assert.equal(
    databaseIdentity(developmentEnv.DEV_DATABASE_URL),
    databaseIdentity(developmentEnv.DEV_DIRECT_DATABASE_URL),
  )
})

test('development never falls back to DATABASE_URL', () => {
  assert.throws(() => resolvePrismaCommand('status', 'development', {
    APP_ENV: 'local', DB_TARGET: 'development',
    DATABASE_URL: 'postgresql://user:secret@production.example.com/app',
  }), /DEV_DATABASE_URL is required/)
})

test('rejects pooled migration URLs and target mismatches', () => {
  assert.throws(() => resolvePrismaCommand('status', 'development', {
    ...developmentEnv,
    DEV_DIRECT_DATABASE_URL: developmentEnv.DEV_DATABASE_URL,
  }), /direct connection/)
  assert.throws(() => resolvePrismaCommand('status', 'development', {
    ...developmentEnv,
    DB_TARGET: 'production',
  }), /requires APP_ENV=local and DB_TARGET=development/)
})

test('migrate dev requires a separate shadow target and permits an isolated integration schema', () => {
  assert.deepEqual(resolvePrismaCommand('migrate-dev', 'development', developmentEnv).args, ['migrate', 'dev'])
  assert.throws(() => resolvePrismaCommand('migrate-dev', 'development', {
    ...developmentEnv,
    SHADOW_DATABASE_URL: developmentEnv.DEV_DIRECT_DATABASE_URL,
  }), /SHADOW_DATABASE_URL must target a different database/)
  assert.deepEqual(resolvePrismaCommand('migrate-dev', 'development', {
    ...developmentEnv,
    TEST_DATABASE_URL: `${developmentEnv.DEV_DIRECT_DATABASE_URL}?schema=myleague_integration`,
  }).args, ['migrate', 'dev'])
})

test('production deploy remains blocked', () => {
  assert.throws(() => resolvePrismaCommand('migrate-deploy', 'production', {
    APP_ENV: 'production', DB_TARGET: 'production',
    DATABASE_URL: 'postgresql://user:secret@production-pooler.example.com/app',
    DIRECT_DATABASE_URL: 'postgresql://user:secret@production.example.com/app',
  }), /Production migrations are disabled/)
})

test('development scripts use only the validated pooled development URL', () => {
  assert.equal(resolveDevelopmentScriptDatabase(developmentEnv), developmentEnv.DEV_DATABASE_URL)
  assert.throws(() => resolveDevelopmentScriptDatabase({
    ...developmentEnv,
    APP_ENV: 'production',
    DB_TARGET: 'production',
    DATABASE_URL: 'postgresql://user:secret@production-pooler.example.com/app',
  }), /requires APP_ENV=local and DB_TARGET=development/)
})
