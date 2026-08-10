import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PRISMA_COMMAND_AUTH, resolvePrismaCommand } from './db-safety.mjs'

const [action, target] = process.argv.slice(2)

try {
  const command = resolvePrismaCommand(action, target)
  const childEnv = { ...process.env }
  for (const name of [
    'DATABASE_URL', 'DIRECT_DATABASE_URL', 'DEV_DATABASE_URL', 'DEV_DIRECT_DATABASE_URL',
    'TEST_DATABASE_URL', 'SHADOW_DATABASE_URL',
  ]) {
    delete childEnv[name]
  }
  childEnv.PRISMA_COMMAND_AUTH = PRISMA_COMMAND_AUTH
  childEnv.PRISMA_DATABASE_URL = command.databaseUrl
  if (command.shadowDatabaseUrl) {
    childEnv.PRISMA_SHADOW_DATABASE_URL = command.shadowDatabaseUrl
  } else {
    delete childEnv.PRISMA_SHADOW_DATABASE_URL
  }

  const result = spawnSync(
    process.execPath,
    [requireResolvePrisma(), ...command.args, '--config', 'prisma.config.ts'],
    { cwd: process.cwd(), env: childEnv, stdio: 'inherit' },
  )
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
} catch (error) {
  console.error(`Database command blocked: ${error instanceof Error ? error.message : 'unknown error'}`)
  process.exit(1)
}

function requireResolvePrisma() {
  return fileURLToPath(import.meta.resolve('prisma/build/index.js'))
}
