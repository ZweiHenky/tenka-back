import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  APPROVED_BILLING_CATALOG_SHA256,
  APPROVED_BILLING_CATALOG_VERSION,
  SAFE_PRISMA_URL,
  databaseIdentity,
  resolveBillingCatalogPromotion,
  resolveDevelopmentScriptDatabase,
  resolvePrismaCommand,
  resolveProductionBillingMigrationPreparation,
} from './db-safety.mjs'
import { resolveDevelopmentScriptOptions } from './development-script-policy.mjs'

const developmentEnv = {
  APP_ENV: 'local',
  DB_TARGET: 'development',
  DEV_DATABASE_URL: 'postgresql://user:secret@ep-development-pooler.example.com/app',
  DEV_DIRECT_DATABASE_URL: 'postgresql://user:secret@ep-development.example.com/app',
  TEST_DATABASE_URL: 'postgresql://user:secret@ep-integration.example.com/app?schema=tenka_integration',
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
const previewEnv = {
  APP_ENV: 'preview',
  DB_TARGET: 'preview',
  DATABASE_URL: 'postgresql://user:secret@ep-preview-pooler.example.com/app',
  DIRECT_DATABASE_URL: 'postgresql://user:secret@ep-preview.example.com/app',
  RAILWAY_ENVIRONMENT_NAME: 'staging',
  RAILWAY_PROJECT_ID: 'project-1',
  RAILWAY_SERVICE_ID: 'service-preview',
}

function catalogOptions(action, target) {
  return [
    `--manifest=${APPROVED_BILLING_CATALOG_VERSION}`,
    `--manifest-sha256=${APPROVED_BILLING_CATALOG_SHA256}`,
    `--confirm=billing-catalog-${target}-${action}`,
    ...(target === 'production' ? productionOptions : []),
  ]
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

test('migrate dev requires a separate shadow target', () => {
  assert.deepEqual(resolvePrismaCommand('migrate-dev', 'development', developmentEnv).args, ['migrate', 'dev'])
  assert.throws(() => resolvePrismaCommand('migrate-dev', 'development', {
    ...developmentEnv,
    SHADOW_DATABASE_URL: developmentEnv.DEV_DIRECT_DATABASE_URL,
  }), /SHADOW_DATABASE_URL must target a different database/)
})

test('development reset requires its explicit confirmation and cannot target production', () => {
  assert.deepEqual(
    resolvePrismaCommand('migrate-reset', 'development', developmentEnv, ['--confirm=development-reset']).args,
    ['migrate', 'reset', '--force'],
  )
  assert.throws(
    () => resolvePrismaCommand('migrate-reset', 'development', developmentEnv),
    /requires --confirm=development-reset/,
  )
  assert.throws(
    () => resolvePrismaCommand('migrate-reset', 'production', productionEnv, ['--confirm=development-reset']),
    /only allowed for the development target/,
  )
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

test('production resolve only rolls back a named migration behind production guards', () => {
  const migration = '20260813233356_league_timezone_and_instant'
  assert.deepEqual(
    resolvePrismaCommand('migrate-resolve', 'production', productionEnv, [
      ...productionOptions,
      `--migration=${migration}`,
    ]).args,
    ['migrate', 'resolve', '--rolled-back', migration],
  )
  assert.throws(
    () => resolvePrismaCommand('migrate-resolve', 'production', productionEnv, productionOptions),
    /requires a valid --migration/,
  )
  assert.throws(
    () => resolvePrismaCommand('migrate-resolve', 'development', developmentEnv, [
      '--migration=20260813233356_league_timezone_and_instant',
    ]),
    /only allowed for preview or production targets/,
  )
})

test('preview resolve rolls back one named migration behind an explicit staging confirmation', () => {
  const migration = '20261007120000_billing_change_operations'
  assert.deepEqual(
    resolvePrismaCommand('migrate-resolve', 'preview', previewEnv, [
      `--migration=${migration}`,
      '--confirm=preview-migration-rollback',
    ]).args,
    ['migrate', 'resolve', '--rolled-back', migration],
  )
  assert.throws(
    () => resolvePrismaCommand('migrate-resolve', 'preview', previewEnv, [`--migration=${migration}`]),
    /requires exactly one --confirm=preview-migration-rollback/,
  )
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

test('production billing preparation accepts explicit cohorts of 1 to 10 accounts', () => {
  const confirmations = [
    '--confirm=billing-migration-preparation', '--confirm=production', '--confirm-snapshot',
  ]
  const one = resolveProductionBillingMigrationPreparation([
    '--billing-account-id=billing_account01', ...confirmations,
  ], productionEnv)
  assert.deepEqual(one.billingAccountIds, ['billing_account01'])
  assert.equal(one.databaseUrl, productionEnv.DATABASE_URL)
  const tenAccounts = Array.from({ length: 10 }, (_, index) => `--billing-account-id=billing_account${index}`)
  assert.equal(resolveProductionBillingMigrationPreparation([
    ...tenAccounts, ...confirmations,
  ], productionEnv).billingAccountIds.length, 10)
})

test('production billing preparation rejects unsafe cohorts and contexts without exposing IDs', () => {
  const confirmations = [
    '--confirm=billing-migration-preparation', '--confirm=production', '--confirm-snapshot',
  ]
  assert.throws(
    () => resolveProductionBillingMigrationPreparation(confirmations, productionEnv),
    /between 1 and 10/,
  )
  assert.throws(
    () => resolveProductionBillingMigrationPreparation([
      ...Array.from({ length: 11 }, (_, index) => `--billing-account-id=billing_account${index}`),
      ...confirmations,
    ], productionEnv),
    /between 1 and 10/,
  )
  assert.throws(
    () => resolveProductionBillingMigrationPreparation([
      '--billing-account-id=billing_account01', '--billing-account-id=billing_account01', ...confirmations,
    ], productionEnv),
    /unique billing accounts/,
  )
  const rejected = 'private/customer@example.com'
  try {
    resolveProductionBillingMigrationPreparation([
      `--billing-account-id=${rejected}`, ...confirmations,
    ], productionEnv)
    assert.fail('expected invalid account ID to be blocked')
  } catch (error) {
    assert.doesNotMatch(error.message, new RegExp(rejected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.throws(
    () => resolveProductionBillingMigrationPreparation([
      '--billing-account-id=billing_account01', ...confirmations,
    ], { ...productionEnv, RAILWAY_ENVIRONMENT_NAME: 'preview' }),
    /Railway production environment/,
  )
})

test('production billing preparation dry-run opens no database connection', () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('./production-billing-script.mjs', import.meta.url)),
      '--billing-account-id=billing_account01',
      '--confirm=billing-migration-preparation', '--confirm=production', '--confirm-snapshot', '--dry-run',
    ],
    { cwd: process.cwd(), env: { ...process.env, ...productionEnv }, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /No database connection was opened/)
  assert.doesNotMatch(result.stdout, /Loaded Prisma config/)
})

test('billing catalog promotion accepts only the approved manifest in its exact target', () => {
  const preview = resolveBillingCatalogPromotion('load', 'preview', catalogOptions('load', 'preview'), previewEnv)
  assert.equal(preview.databaseUrl, previewEnv.DATABASE_URL)
  assert.deepEqual(preview.childArgs, ['load', 'preview', ...catalogOptions('load', 'preview')])

  const production = resolveBillingCatalogPromotion(
    'activate', 'production', catalogOptions('activate', 'production'), productionEnv,
  )
  assert.equal(production.databaseUrl, productionEnv.DATABASE_URL)
  assert.deepEqual(production.childArgs, [
    'activate', 'production', ...catalogOptions('activate', 'production'),
  ])
})

test('billing catalog promotion fails closed across preview and production', () => {
  assert.throws(
    () => resolveBillingCatalogPromotion('load', 'preview', catalogOptions('load', 'preview'), productionEnv),
    /requires APP_ENV=preview and DB_TARGET=preview/,
  )
  assert.throws(
    () => resolveBillingCatalogPromotion('load', 'production', catalogOptions('load', 'production'), previewEnv),
    /requires APP_ENV=production and DB_TARGET=production/,
  )
  assert.throws(
    () => resolveBillingCatalogPromotion('load', 'preview', catalogOptions('load', 'preview'), {
      ...previewEnv, RAILWAY_ENVIRONMENT_NAME: 'production',
    }),
    /Railway staging environment/,
  )
  assert.throws(
    () => resolveBillingCatalogPromotion('load', 'production', catalogOptions('load', 'production'), {
      ...productionEnv, PRODUCTION_MIGRATION_TOKEN: '',
    }),
    /64-character hexadecimal secret/,
  )
})

test('billing catalog promotion rejects altered manifests, confirmations, URLs, and options', () => {
  const previewOptions = catalogOptions('load', 'preview')
  assert.throws(
    () => resolveBillingCatalogPromotion('load', 'preview', [
      ...previewOptions.filter((option) => !option.startsWith('--manifest-sha256=')),
      `--manifest-sha256=${'0'.repeat(64)}`,
    ], previewEnv),
    /unsupported option/,
  )
  assert.throws(
    () => resolveBillingCatalogPromotion('load', 'preview', previewOptions.filter(
      (option) => option !== '--confirm=billing-catalog-preview-load',
    ), previewEnv),
    /requires exactly one --confirm=billing-catalog-preview-load/,
  )
  assert.throws(
    () => resolveBillingCatalogPromotion('load', 'preview', [...previewOptions, '--unknown'], previewEnv),
    /unsupported option/,
  )
  assert.throws(
    () => resolveBillingCatalogPromotion('load', 'preview', previewOptions, {
      ...previewEnv, DIRECT_DATABASE_URL: previewEnv.DATABASE_URL,
    }),
    /direct connection/,
  )
  assert.throws(
    () => resolveBillingCatalogPromotion('load', 'preview', previewOptions, {
      ...previewEnv, DIRECT_DATABASE_URL: 'postgresql://user:secret@ep-other.example.com/app',
    }),
    /must target the same database/,
  )
  assert.throws(
    () => resolveBillingCatalogPromotion('load', 'preview', previewOptions, {
      ...previewEnv, DATABASE_URL: `${previewEnv.DATABASE_URL}?schema=public`,
    }),
    /must not override the database schema/,
  )
})

test('billing catalog promotion dry-runs do not load TypeScript or open a database connection', () => {
  for (const [action, target, targetEnv] of [
    ['load', 'preview', previewEnv],
    ['activate', 'production', productionEnv],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('./billing-catalog-promotion-script.mjs', import.meta.url)),
        action, target, ...catalogOptions(action, target), '--dry-run',
      ],
      { cwd: process.cwd(), env: { ...process.env, ...targetEnv }, encoding: 'utf8' },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /No database connection was opened/)
    assert.doesNotMatch(result.stdout, /ts-node-dev|Loaded Prisma|Prisma schema/)
  }
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

test('RevenueCat sandbox reconciliation accepts one canonical account and explicit confirmation', () => {
  assert.deepEqual(resolveDevelopmentScriptOptions('reconcile-revenuecat-sandbox', [
    '--billing-account-id=billing_123',
    '--confirm=revenuecat-sandbox-reconciliation',
  ]), {
    dryRun: false,
    childArgs: [
      '--billing-account-id=billing_123',
      '--confirm=revenuecat-sandbox-reconciliation',
    ],
  })
  assert.equal(resolveDevelopmentScriptOptions('reconcile-revenuecat-sandbox', [
    '--billing-account-id=billing_123',
    '--confirm=revenuecat-sandbox-reconciliation',
    '--dry-run',
  ]).dryRun, true)
})

test('RevenueCat sandbox reconciliation rejects missing, duplicate, and unsupported arguments', () => {
  const confirmation = '--confirm=revenuecat-sandbox-reconciliation'
  assert.throws(
    () => resolveDevelopmentScriptOptions('reconcile-revenuecat-sandbox', [confirmation]),
    /exactly one --billing-account-id/,
  )
  assert.throws(
    () => resolveDevelopmentScriptOptions('reconcile-revenuecat-sandbox', [
      '--billing-account-id=billing_1', '--billing-account-id=billing_2', confirmation,
    ]),
    /exactly one --billing-account-id/,
  )
  assert.throws(
    () => resolveDevelopmentScriptOptions('reconcile-revenuecat-sandbox', [
      '--billing-account-id=billing_1', confirmation, '--unknown=value',
    ]),
    /unsupported option/,
  )
  assert.throws(
    () => resolveDevelopmentScriptOptions('reconcile-revenuecat-sandbox', [
      '--billing-account-id=anonymous-user', confirmation,
    ]),
    /valid canonical billing account ID/,
  )
})

test('RevenueCat sandbox reconciliation validation never echoes a rejected account ID', () => {
  const rejected = 'private/customer@example.com'
  try {
    resolveDevelopmentScriptOptions('reconcile-revenuecat-sandbox', [
      `--billing-account-id=${rejected}`,
      '--confirm=revenuecat-sandbox-reconciliation',
    ])
    assert.fail('expected invalid account ID to be blocked')
  } catch (error) {
    assert.doesNotMatch(error.message, new RegExp(rejected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('billing migration read-only commands reject arguments except one dry-run', () => {
  for (const name of ['audit-billing-migration-candidates', 'validate-billing-migration']) {
    assert.deepEqual(resolveDevelopmentScriptOptions(name, []), { dryRun: false, childArgs: [] })
    assert.deepEqual(resolveDevelopmentScriptOptions(name, ['--dry-run']), { dryRun: true, childArgs: [] })
    assert.throws(() => resolveDevelopmentScriptOptions(name, ['--unknown']), /unsupported option/)
    assert.throws(() => resolveDevelopmentScriptOptions(name, ['--dry-run', '--dry-run']), /unsupported option/)
  }
})

test('billing migration preparation requires a JSON cohort and explicit confirmation', () => {
  const options = ['--input=private/cohort.json', '--confirm=billing-migration-preparation']
  assert.deepEqual(resolveDevelopmentScriptOptions('prepare-billing-migration', options), {
    dryRun: false,
    childArgs: options,
  })
  assert.equal(resolveDevelopmentScriptOptions('prepare-billing-migration', [...options, '--dry-run']).dryRun, true)
  assert.throws(
    () => resolveDevelopmentScriptOptions('prepare-billing-migration', ['--input=private/cohort.json']),
    /requires --confirm=billing-migration-preparation/,
  )
  assert.throws(
    () => resolveDevelopmentScriptOptions('prepare-billing-migration', [
      '--input=private/cohort.txt', '--confirm=billing-migration-preparation',
    ]),
    /valid JSON input path/,
  )
  assert.throws(
    () => resolveDevelopmentScriptOptions('prepare-billing-migration', [...options, '--unknown']),
    /unsupported option/,
  )
})

test('legacy migration fixture requires one canonical account and explicit confirmation', () => {
  const options = [
    '--billing-account-id=billing_fixture_account01',
    '--confirm=create-legacy-billing-migration-candidate',
  ]
  assert.deepEqual(resolveDevelopmentScriptOptions(
    'create-legacy-billing-migration-candidate', options,
  ), { dryRun: false, childArgs: options })
  assert.equal(resolveDevelopmentScriptOptions(
    'create-legacy-billing-migration-candidate', [...options, '--dry-run'],
  ).dryRun, true)
  assert.throws(
    () => resolveDevelopmentScriptOptions('create-legacy-billing-migration-candidate', [options[1]]),
    /exactly one --billing-account-id/,
  )
  assert.throws(
    () => resolveDevelopmentScriptOptions('create-legacy-billing-migration-candidate', [options[0]]),
    /requires --confirm=create-legacy-billing-migration-candidate/,
  )
  assert.throws(
    () => resolveDevelopmentScriptOptions('create-legacy-billing-migration-candidate', [
      '--billing-account-id=private/customer@example.com', options[1],
    ]),
    /valid canonical billing account ID/,
  )
})

test('legacy migration fixture dry-run validates without loading TypeScript or opening a connection', () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('./development-script.mjs', import.meta.url)),
      'create-legacy-billing-migration-candidate',
      '--billing-account-id=billing_fixture_account01',
      '--confirm=create-legacy-billing-migration-candidate',
      '--dry-run',
    ],
    { cwd: process.cwd(), env: { ...process.env, ...developmentEnv }, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Protected development script is ready/)
  assert.doesNotMatch(result.stdout, /ts-node-dev|Loaded Prisma|Prisma schema/)
})

test('development billing account rotation requires an explicit account and confirmation', () => {
  const options = [
    '--billing-account-id=billing_original_account',
    '--confirm=rotate-development-billing-account',
  ]
  assert.deepEqual(resolveDevelopmentScriptOptions('rotate-development-billing-account', options), {
    dryRun: false, childArgs: options,
  })
  assert.equal(resolveDevelopmentScriptOptions(
    'rotate-development-billing-account', [...options, '--dry-run'],
  ).dryRun, true)
  assert.throws(
    () => resolveDevelopmentScriptOptions('rotate-development-billing-account', [options[1]]),
    /exactly one --billing-account-id/,
  )
})

test('billing free foundation audit is read-only and reconciliation requires confirmation', () => {
  assert.deepEqual(resolveDevelopmentScriptOptions('audit-billing-free-foundation', []), {
    dryRun: false, childArgs: [],
  })
  assert.deepEqual(resolveDevelopmentScriptOptions('audit-billing-free-foundation', ['--dry-run']), {
    dryRun: true, childArgs: [],
  })
  const confirmation = '--confirm=billing-free-foundation-reconciliation'
  assert.deepEqual(resolveDevelopmentScriptOptions('reconcile-billing-free-foundation', [confirmation]), {
    dryRun: false, childArgs: [confirmation],
  })
  assert.equal(resolveDevelopmentScriptOptions(
    'reconcile-billing-free-foundation', [confirmation, '--dry-run'],
  ).dryRun, true)
  assert.throws(
    () => resolveDevelopmentScriptOptions('reconcile-billing-free-foundation', []),
    /requires --confirm=billing-free-foundation-reconciliation/,
  )
  assert.throws(
    () => resolveDevelopmentScriptOptions('reconcile-billing-free-foundation', [confirmation, '--unknown']),
    /unsupported option/,
  )
})

test('billing operational control audit accepts only an optional dry-run', () => {
  assert.deepEqual(resolveDevelopmentScriptOptions('audit-billing-operational-control', []), {
    dryRun: false, childArgs: [],
  })
  assert.deepEqual(resolveDevelopmentScriptOptions('audit-billing-operational-control', ['--dry-run']), {
    dryRun: true, childArgs: [],
  })
  assert.throws(
    () => resolveDevelopmentScriptOptions('audit-billing-operational-control', ['--unknown']),
    /unsupported option/,
  )
})
