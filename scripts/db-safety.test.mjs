import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { SAFE_PRISMA_URL, databaseIdentity, resolveDevelopmentScriptDatabase, resolvePrismaCommand } from './db-safety.mjs'

const developmentEnv = {
  APP_ENV: 'local',
  DB_TARGET: 'development',
  DEV_DATABASE_URL: 'postgresql://user:secret@ep-development-pooler.example.com/app',
  DEV_DIRECT_DATABASE_URL: 'postgresql://user:secret@ep-development.example.com/app',
  TEST_DATABASE_URL: 'postgresql://user:secret@ep-integration.example.com/app?schema=myleague_integration',
  SHADOW_DATABASE_URL: 'postgresql://user:secret@ep-shadow.example.com/app',
}

const productionToken = 'a'.repeat(64)
const productionEnv = {
  APP_ENV: 'production',
  DB_TARGET: 'production',
  DATABASE_URL: 'postgresql://user:secret@ep-production-pooler.example.com/app',
  DIRECT_DATABASE_URL: 'postgresql://user:secret@ep-production.example.com/app',
  PRODUCTION_MIGRATION_TOKEN: productionToken,
  RAILWAY_ENVIRONMENT_NAME: 'production',
  RAILWAY_PROJECT_ID: 'project-1',
  RAILWAY_SERVICE_ID: 'service-1',
}
const productionOptions = ['--confirm=production', '--confirm-snapshot']

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

test('production status requires Railway production context', () => {
  assert.deepEqual(resolvePrismaCommand('status', 'production', productionEnv).args, ['migrate', 'status'])
  assert.throws(() => resolvePrismaCommand('status', 'production', {
    ...productionEnv,
    RAILWAY_ENVIRONMENT_NAME: 'staging',
  }), /requires the Railway production environment/)
  assert.throws(() => resolvePrismaCommand('status', 'production', {
    ...productionEnv,
    RAILWAY_SERVICE_ID: '',
  }), /requires Railway project and service context/)
})

test('production deploy requires Railway, token, production and snapshot confirmations', () => {
  assert.deepEqual(
    resolvePrismaCommand('migrate-deploy', 'production', productionEnv, productionOptions).args,
    ['migrate', 'deploy'],
  )
  assert.throws(() => resolvePrismaCommand('migrate-deploy', 'production', {
    ...productionEnv,
    RAILWAY_ENVIRONMENT_NAME: 'staging',
  }, productionOptions), /requires the Railway production environment/)
  assert.throws(() => resolvePrismaCommand('migrate-deploy', 'production', {
    ...productionEnv,
    PRODUCTION_MIGRATION_TOKEN: '',
  }, productionOptions), /64-character hexadecimal secret/)
  assert.throws(() => resolvePrismaCommand('migrate-deploy', 'production', productionEnv, [
    '--confirm-snapshot',
  ]), /requires --confirm=production/)
  assert.throws(() => resolvePrismaCommand('migrate-deploy', 'production', productionEnv, [
    '--confirm=production',
  ]), /requires --confirm-snapshot/)
})

test('production guard errors never expose the migration token', () => {
  try {
    resolvePrismaCommand('migrate-deploy', 'production', {
      ...productionEnv,
      RAILWAY_ENVIRONMENT_NAME: 'staging',
    }, productionOptions)
    assert.fail('expected production migration to be blocked')
  } catch (error) {
    assert.doesNotMatch(error.message, new RegExp(productionToken))
  }
})

test('production dry-run validates without loading or executing Prisma', () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('./prisma-command.mjs', import.meta.url)),
      'migrate-deploy', 'production', ...productionOptions, '--dry-run',
    ],
    { cwd: process.cwd(), env: { ...process.env, ...productionEnv }, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /No database connection was opened/)
  assert.doesNotMatch(result.stdout, /Loaded Prisma config/)
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
