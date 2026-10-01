import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEVELOPMENT_SCRIPT_AUTH, resolveDevelopmentScriptDatabase } from './db-safety.mjs'
import { resolveDevelopmentScriptOptions } from './development-script-policy.mjs'

const scripts = {
  seed: 'prisma/seed.ts',
  'seed-catalogs': 'prisma/seed-catalogs.ts',
  'load-billing-catalog': 'prisma/load-billing-catalog.ts',
  'approve-activate-billing-catalog': 'prisma/approve-activate-billing-catalog.ts',
  'reconcile-revenuecat-sandbox': 'prisma/reconcile-revenuecat-sandbox.ts',
  'audit-billing-migration-candidates': 'prisma/audit-billing-migration-candidates.ts',
  'prepare-billing-migration': 'prisma/prepare-billing-migration.ts',
  'create-legacy-billing-migration-candidate': 'prisma/create-legacy-billing-migration-candidate.ts',
  'rotate-development-billing-account': 'prisma/rotate-development-billing-account.ts',
  'validate-billing-migration': 'prisma/validate-billing-migration.ts',
  'audit-billing-free-foundation': 'prisma/audit-billing-free-foundation.ts',
  'reconcile-billing-free-foundation': 'prisma/reconcile-billing-free-foundation.ts',
  'audit-billing-operational-control': 'prisma/audit-billing-operational-control.ts',
  'create-teams': 'prisma/create-teams.ts',
  'assign-teams': 'prisma/assign-teams.ts',
  'check-teams': 'prisma/check-teams.ts',
  'find-division': 'scripts/find-division.ts',
  'add-teams': 'scripts/add-teams.ts',
  'seed-teams': 'src/scripts/seed-teams.ts',
}

const [name, ...options] = process.argv.slice(2)
const script = scripts[name]

try {
  if (!script) throw new Error(`Unsupported development script: ${name || '(missing)'}`)
  const invocation = resolveDevelopmentScriptOptions(name, options)

  const databaseUrl = resolveDevelopmentScriptDatabase()
  if (!existsSync(resolve(process.cwd(), script))) throw new Error(`Script file not found: ${script}`)
  if (invocation.dryRun) {
    console.log(`Protected development script is ready: ${name}`)
    process.exit(0)
  }
  const childEnv = { ...process.env }
  for (const variable of [
    'DATABASE_URL', 'DIRECT_DATABASE_URL', 'DEV_DATABASE_URL', 'DEV_DIRECT_DATABASE_URL',
    'TEST_DATABASE_URL', 'SHADOW_DATABASE_URL',
  ]) {
    delete childEnv[variable]
  }
  childEnv.APP_ENV = 'local'
  childEnv.DB_TARGET = 'development'
  childEnv.DEV_DATABASE_URL = databaseUrl
  childEnv.DEV_DIRECT_DATABASE_URL = process.env.DEV_DIRECT_DATABASE_URL
  childEnv.DEVELOPMENT_SCRIPT_AUTH = DEVELOPMENT_SCRIPT_AUTH

  console.log(`Running protected development script: ${name}`)
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve('ts-node-dev/lib/bin.js')),
      '--transpile-only', '--exit-child', script, ...invocation.childArgs,
    ],
    { cwd: process.cwd(), env: childEnv, stdio: 'inherit' },
  )
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
} catch (error) {
  console.error(`Development script blocked: ${error instanceof Error ? error.message : 'unknown error'}`)
  process.exit(1)
}
