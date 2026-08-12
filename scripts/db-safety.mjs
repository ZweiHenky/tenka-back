export const PRISMA_COMMAND_AUTH = 'myleague-prisma-wrapper-v1'
export const DEVELOPMENT_SCRIPT_AUTH = 'myleague-development-script-v1'
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
    const databaseUrl = resolveTargetUrl(target, env)
    const shadow = parsePostgresUrl('SHADOW_DATABASE_URL', env.SHADOW_DATABASE_URL, { direct: true })
    if (databaseIdentity(databaseUrl) === databaseIdentity(shadow)) {
      throw new Error('SHADOW_DATABASE_URL must target a different database')
    }
    return { args: ['migrate', 'dev'], databaseUrl, shadowDatabaseUrl: shadow.href }
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
