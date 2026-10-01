import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PRODUCTION_BILLING_SCRIPT_AUTH,
  resolveProductionBillingMigrationPreparation,
} from './db-safety.mjs'

const script = 'prisma/prepare-billing-migration-production.ts'

try {
  const invocation = resolveProductionBillingMigrationPreparation(process.argv.slice(2))
  if (!existsSync(resolve(process.cwd(), script))) throw new Error('Production billing script file not found')
  if (invocation.dryRun) {
    console.log('Protected production billing migration preparation is ready. No database connection was opened.')
    process.exit(0)
  }

  const childEnv = { ...process.env }
  for (const variable of [
    'DATABASE_URL', 'DIRECT_DATABASE_URL', 'DEV_DATABASE_URL', 'DEV_DIRECT_DATABASE_URL',
    'TEST_DATABASE_URL', 'SHADOW_DATABASE_URL', 'PRODUCTION_MIGRATION_TOKEN',
  ]) delete childEnv[variable]
  childEnv.APP_ENV = 'production'
  childEnv.DB_TARGET = 'production'
  childEnv.DATABASE_URL = invocation.databaseUrl
  childEnv.DIRECT_DATABASE_URL = invocation.directDatabaseUrl
  childEnv.PRODUCTION_BILLING_SCRIPT_AUTH = PRODUCTION_BILLING_SCRIPT_AUTH

  console.log('Running protected production billing migration preparation')
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
  console.error(`Production billing script blocked: ${error instanceof Error ? error.message : 'unknown error'}`)
  process.exit(1)
}
