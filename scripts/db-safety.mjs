export const PRISMA_COMMAND_AUTH = 'tenka-prisma-wrapper-v1'
export const DEVELOPMENT_SCRIPT_AUTH = 'tenka-development-script-v1'
export const PRODUCTION_BILLING_SCRIPT_AUTH = 'tenka-production-billing-script-v1'
export const BILLING_CATALOG_PROMOTION_SCRIPT_AUTH = 'tenka-billing-catalog-promotion-script-v1'
export const APPROVED_BILLING_CATALOG_VERSION = '2026-09-mx-v1'
export const APPROVED_BILLING_CATALOG_SHA256 = '9bb80fc393409a4536c3ec171f47a663127fc50ce7c5b383d663b29f46fb751c'
export const SAFE_PRISMA_URL = 'postgresql://guard:guard@127.0.0.1:5432/prisma_guard'

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:'])

export function parsePostgresUrl(name, value, { direct = false } = {}) {
  if (!value) throw new Error(`${name} is required`)

  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid URL`)
  }
  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`${name} must be a PostgreSQL URL`)
  }
  if (direct && parsed.hostname.toLowerCase().includes('-pooler.')) {
    throw new Error(`${name} must use a direct connection, not a pooled Neon endpoint`)
  }
  return parsed
}

export function databaseIdentity(value) {
  const parsed = typeof value === 'string' ? parsePostgresUrl('database URL', value) : value
  const hostname = parsed.hostname.toLowerCase().replace('-pooler.', '.')
  const port = parsed.port || '5432'
  return `${hostname}:${port}${parsed.pathname}`
}

function assertSameDatabase(runtimeName, runtimeUrl, directName, directUrl) {
  const runtime = parsePostgresUrl(runtimeName, runtimeUrl)
  const direct = parsePostgresUrl(directName, directUrl, { direct: true })
  if (databaseIdentity(runtime) !== databaseIdentity(direct)) {
    throw new Error(`${runtimeName} and ${directName} must target the same database`)
  }
  return direct.href
}

function assertEnvironment(env, target) {
  const expected = {
    development: { appEnv: 'local', dbTarget: 'development' },
    preview: { appEnv: 'preview', dbTarget: 'preview' },
    production: { appEnv: 'production', dbTarget: 'production' },
  }[target]
  if (!expected) throw new Error(`Unsupported database target: ${target || '(missing)'}`)
  if (env.APP_ENV !== expected.appEnv || env.DB_TARGET !== expected.dbTarget) {
    throw new Error(`Target ${target} requires APP_ENV=${expected.appEnv} and DB_TARGET=${expected.dbTarget}`)
  }
}

function assertRailwayProduction(env) {
  if (env.RAILWAY_ENVIRONMENT_NAME !== 'production') {
    throw new Error('Production database access requires the Railway production environment')
  }
  if (!env.RAILWAY_PROJECT_ID || !env.RAILWAY_SERVICE_ID) {
    throw new Error('Production database access requires Railway project and service context')
  }
}

function assertRailwayPreview(env) {
  if (env.RAILWAY_ENVIRONMENT_NAME !== 'staging') {
    throw new Error('Preview billing catalog access requires the Railway staging environment')
  }
  if (!env.RAILWAY_PROJECT_ID || !env.RAILWAY_SERVICE_ID) {
    throw new Error('Preview billing catalog access requires Railway project and service context')
  }
}

function assertProductionMigrationApproval(env, options) {
  if (!/^[a-f0-9]{64}$/i.test(env.PRODUCTION_MIGRATION_TOKEN ?? '')) {
    throw new Error('PRODUCTION_MIGRATION_TOKEN must be a 64-character hexadecimal secret')
  }
  if (!options.includes('--confirm=production')) {
    throw new Error('Production migration requires --confirm=production')
  }
  if (!options.includes('--confirm-snapshot')) {
    throw new Error('Production migration requires --confirm-snapshot')
  }
}

function assertNoSchemaOverride(name, value) {
  const parsed = parsePostgresUrl(name, value)
  if (parsed.searchParams.has('schema') || parsed.searchParams.has('search_path')) {
    throw new Error(`${name} must not override the database schema`)
  }
  return parsed
}

export function resolveBillingCatalogPromotion(action, target, options, env = process.env) {
  if (!['load', 'activate'].includes(action)) {
    throw new Error('Unsupported billing catalog promotion action')
  }
  if (!['preview', 'production'].includes(target)) {
    throw new Error('Unsupported billing catalog promotion target')
  }
  const manifest = `--manifest=${APPROVED_BILLING_CATALOG_VERSION}`
  const digest = `--manifest-sha256=${APPROVED_BILLING_CATALOG_SHA256}`
  const actionConfirmation = `--confirm=billing-catalog-${target}-${action}`
  const productionConfirmations = target === 'production'
    ? ['--confirm=production', '--confirm-snapshot'] : []
  const required = [manifest, digest, actionConfirmation, ...productionConfirmations]
  const allowed = new Set([...required, '--dry-run'])
  if (options.some((option) => !allowed.has(option))) {
    throw new Error('Billing catalog promotion received an unsupported option')
  }
  for (const option of required) {
    if (options.filter((candidate) => candidate === option).length !== 1) {
      throw new Error(`Billing catalog promotion requires exactly one ${option}`)
    }
  }
  if (options.filter((option) => option === '--dry-run').length > 1) {
    throw new Error('Billing catalog promotion received duplicate --dry-run options')
  }

  assertEnvironment(env, target)
  if (target === 'production') {
    assertRailwayProduction(env)
    assertProductionMigrationApproval(env, options)
  } else {
    assertRailwayPreview(env)
  }
  const runtime = assertNoSchemaOverride('DATABASE_URL', env.DATABASE_URL)
  const direct = assertNoSchemaOverride('DIRECT_DATABASE_URL', env.DIRECT_DATABASE_URL)
  if (direct.hostname.toLowerCase().includes('-pooler.')) {
    throw new Error('DIRECT_DATABASE_URL must use a direct connection, not a pooled Neon endpoint')
  }
  if (databaseIdentity(runtime) !== databaseIdentity(direct)) {
    throw new Error('DATABASE_URL and DIRECT_DATABASE_URL must target the same database')
  }
  return {
    childArgs: [action, target, ...required],
    databaseUrl: runtime.href,
    directDatabaseUrl: direct.href,
    dryRun: options.includes('--dry-run'),
  }
}

export function resolveProductionBillingMigrationPreparation(options, env = process.env) {
  const accountPrefix = '--billing-account-id='
  const confirmations = [
    '--confirm=billing-migration-preparation',
    '--confirm=production',
    '--confirm-snapshot',
  ]
  const allowed = new Set([...confirmations, '--dry-run'])
  const accountOptions = options.filter((option) => option.startsWith(accountPrefix))
  if (options.some((option) => !allowed.has(option) && !option.startsWith(accountPrefix))) {
    throw new Error('Production billing migration preparation received an unsupported option')
  }
  for (const confirmation of confirmations) {
    if (options.filter((option) => option === confirmation).length !== 1) {
      throw new Error(`Production billing migration preparation requires exactly one ${confirmation}`)
    }
  }
  if (options.filter((option) => option === '--dry-run').length > 1) {
    throw new Error('Production billing migration preparation received duplicate --dry-run options')
  }
  if (accountOptions.length < 1 || accountOptions.length > 10) {
    throw new Error('Production billing migration preparation requires between 1 and 10 billing accounts')
  }
  const billingAccountIds = accountOptions.map((option) => option.slice(accountPrefix.length))
  if (billingAccountIds.some((id) => !/^billing_[A-Za-z0-9_-]{8,100}$/.test(id))) {
    throw new Error('Production billing migration preparation requires valid canonical billing account IDs')
  }
  if (new Set(billingAccountIds).size !== billingAccountIds.length) {
    throw new Error('Production billing migration preparation requires unique billing accounts')
  }

  assertEnvironment(env, 'production')
  assertRailwayProduction(env)
  assertProductionMigrationApproval(env, options)
  const runtime = assertNoSchemaOverride('DATABASE_URL', env.DATABASE_URL)
  const direct = assertNoSchemaOverride('DIRECT_DATABASE_URL', env.DIRECT_DATABASE_URL)
  if (direct.hostname.toLowerCase().includes('-pooler.')) {
    throw new Error('DIRECT_DATABASE_URL must use a direct connection, not a pooled Neon endpoint')
  }
  if (databaseIdentity(runtime) !== databaseIdentity(direct)) {
    throw new Error('DATABASE_URL and DIRECT_DATABASE_URL must target the same database')
  }
  return {
    billingAccountIds,
    childArgs: [...accountOptions, ...confirmations],
    databaseUrl: runtime.href,
    directDatabaseUrl: direct.href,
    dryRun: options.includes('--dry-run'),
  }
}

function resolveTargetUrl(target, env) {
  assertEnvironment(env, target)
  if (target === 'development') {
    return assertSameDatabase(
      'DEV_DATABASE_URL', env.DEV_DATABASE_URL,
      'DEV_DIRECT_DATABASE_URL', env.DEV_DIRECT_DATABASE_URL,
    )
  }
  return assertSameDatabase(
    'DATABASE_URL', env.DATABASE_URL,
    'DIRECT_DATABASE_URL', env.DIRECT_DATABASE_URL,
  )
}

export function resolveDevelopmentScriptDatabase(env = process.env) {
  assertEnvironment(env, 'development')
  assertSameDatabase(
    'DEV_DATABASE_URL', env.DEV_DATABASE_URL,
    'DEV_DIRECT_DATABASE_URL', env.DEV_DIRECT_DATABASE_URL,
  )
  return parsePostgresUrl('DEV_DATABASE_URL', env.DEV_DATABASE_URL).href
}

export function resolvePrismaCommand(action, target, env = process.env, options = []) {
  if (action === 'generate') {
    return { args: ['generate'], databaseUrl: SAFE_PRISMA_URL }
  }
  if (action === 'validate') {
    return { args: ['validate'], databaseUrl: SAFE_PRISMA_URL }
  }
  if (action === 'status') {
    if (target === 'production') assertRailwayProduction(env)
    return { args: ['migrate', 'status'], databaseUrl: resolveTargetUrl(target, env) }
  }
  if (action === 'migrate-dev') {
    if (target !== 'development') throw new Error('migrate dev is only allowed for the development target')
    const allowedOptions = options.every((option) => option === '--create-only'
      || /^--name=[a-z0-9_-]+$/.test(option))
    if (!allowedOptions) throw new Error('migrate dev received an unsupported option')
    const databaseUrl = resolveTargetUrl(target, env)
    const shadow = parsePostgresUrl('SHADOW_DATABASE_URL', env.SHADOW_DATABASE_URL, { direct: true })
    if (databaseIdentity(databaseUrl) === databaseIdentity(shadow)) {
      throw new Error('SHADOW_DATABASE_URL must target a different database')
    }
    return { args: ['migrate', 'dev', ...options], databaseUrl, shadowDatabaseUrl: shadow.href }
  }
  if (action === 'migrate-reset') {
    if (target !== 'development') throw new Error('migrate reset is only allowed for the development target')
    if (!options.includes('--confirm=development-reset')) {
      throw new Error('Development reset requires --confirm=development-reset')
    }
    return { args: ['migrate', 'reset', '--force'], databaseUrl: resolveTargetUrl(target, env) }
  }
  if (action === 'migrate-resolve') {
    if (target !== 'production') throw new Error('migrate resolve is only allowed for the production target')
    assertRailwayProduction(env)
    assertProductionMigrationApproval(env, options)
    const migrationOption = options.find((option) => option.startsWith('--migration='))
    const migration = migrationOption?.slice('--migration='.length)
    if (!migration || !/^\d{14}_[a-z0-9_]+$/.test(migration)) {
      throw new Error('Production migration resolve requires a valid --migration=<migration_name>')
    }
    return {
      args: ['migrate', 'resolve', '--rolled-back', migration],
      databaseUrl: resolveTargetUrl(target, env),
    }
  }
  if (action === 'migrate-deploy') {
    if (target === 'production') {
      assertRailwayProduction(env)
      assertProductionMigrationApproval(env, options)
      return { args: ['migrate', 'deploy'], databaseUrl: resolveTargetUrl(target, env) }
    }
    if (target !== 'preview') {
      throw new Error('migrate deploy is only allowed for preview in this implementation stage')
    }
    return { args: ['migrate', 'deploy'], databaseUrl: resolveTargetUrl(target, env) }
  }
  throw new Error(`Unsupported Prisma action: ${action || '(missing)'}`)
}
