import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BILLING_CATALOG_PROMOTION_SCRIPT_AUTH,
  resolveBillingCatalogPromotion,
} from './db-safety.mjs'

const [action, target, ...options] = process.argv.slice(2)
const script = 'prisma/promote-billing-catalog.ts'
const evidence = 'docs/billing/pricing/2026-09-mx-v1.json'

try {
  const invocation = resolveBillingCatalogPromotion(action, target, options)
  if (!existsSync(resolve(process.cwd(), script))) throw new Error('Billing catalog promotion script file not found')
  if (!existsSync(resolve(process.cwd(), evidence))) throw new Error('Approved billing catalog pricing evidence file not found')
  if (invocation.dryRun) {
    console.log(`Protected billing catalog ${action} is ready for ${target}. No database connection was opened.`)
    process.exit(0)
  }

  const childEnv = { ...process.env }
  for (const variable of [
    'DATABASE_URL', 'DIRECT_DATABASE_URL', 'DEV_DATABASE_URL', 'DEV_DIRECT_DATABASE_URL',
    'TEST_DATABASE_URL', 'SHADOW_DATABASE_URL', 'PRODUCTION_MIGRATION_TOKEN',
  ]) delete childEnv[variable]
  childEnv.APP_ENV = target === 'production' ? 'production' : 'preview'
  childEnv.DB_TARGET = target
  childEnv.DATABASE_URL = invocation.databaseUrl
  childEnv.DIRECT_DATABASE_URL = invocation.directDatabaseUrl
  childEnv.BILLING_CATALOG_PROMOTION_SCRIPT_AUTH = BILLING_CATALOG_PROMOTION_SCRIPT_AUTH
  childEnv.BILLING_CATALOG_PROMOTION_TARGET = target

  console.log(`Running protected billing catalog ${action} for ${target}`)
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
  console.error(`Billing catalog promotion blocked: ${error instanceof Error ? error.message : 'unknown error'}`)
  process.exit(1)
}
