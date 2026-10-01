const RECONCILIATION_CONFIRMATION = '--confirm=revenuecat-sandbox-reconciliation'
const BILLING_ACCOUNT_OPTION = '--billing-account-id='
const BILLING_MIGRATION_CONFIRMATION = '--confirm=billing-migration-preparation'
const INPUT_OPTION = '--input='
const FREE_FOUNDATION_CONFIRMATION = '--confirm=billing-free-foundation-reconciliation'
const LEGACY_MIGRATION_FIXTURE_CONFIRMATION = '--confirm=create-legacy-billing-migration-candidate'
const DEVELOPMENT_BILLING_ROTATION_CONFIRMATION = '--confirm=rotate-development-billing-account'

function freeFoundationReconciliationOptions(options) {
  for (const option of options) {
    if (![FREE_FOUNDATION_CONFIRMATION, '--dry-run'].includes(option)) {
      throw new Error('Billing free foundation reconciliation received an unsupported option')
    }
  }
  if (options.filter((option) => option === FREE_FOUNDATION_CONFIRMATION).length !== 1) {
    throw new Error(`Billing free foundation reconciliation requires ${FREE_FOUNDATION_CONFIRMATION}`)
  }
  if (options.filter((option) => option === '--dry-run').length > 1) {
    throw new Error('Billing free foundation reconciliation received duplicate --dry-run options')
  }
  return { dryRun: options.includes('--dry-run'), childArgs: [FREE_FOUNDATION_CONFIRMATION] }
}

function readOnlyOptions(name, options) {
  if (options.some((option) => option !== '--dry-run')
    || options.filter((option) => option === '--dry-run').length > 1) {
    throw new Error(`${name} received an unsupported option`)
  }
  return { dryRun: options.includes('--dry-run'), childArgs: [] }
}

function billingMigrationPreparationOptions(options) {
  const inputOptions = options.filter((option) => option.startsWith(INPUT_OPTION))
  for (const option of options) {
    if (![BILLING_MIGRATION_CONFIRMATION, '--dry-run'].includes(option) && !option.startsWith(INPUT_OPTION)) {
      throw new Error('Billing migration preparation received an unsupported option')
    }
  }
  if (inputOptions.length !== 1) throw new Error('Billing migration preparation requires exactly one --input')
  if (options.filter((option) => option === BILLING_MIGRATION_CONFIRMATION).length !== 1) {
    throw new Error(`Billing migration preparation requires ${BILLING_MIGRATION_CONFIRMATION}`)
  }
  if (options.filter((option) => option === '--dry-run').length > 1) {
    throw new Error('Billing migration preparation received duplicate --dry-run options')
  }
  const input = inputOptions[0].slice(INPUT_OPTION.length)
  if (!input || !input.toLowerCase().endsWith('.json') || input.includes('\0')) {
    throw new Error('Billing migration preparation requires a valid JSON input path')
  }
  return {
    dryRun: options.includes('--dry-run'),
    childArgs: [inputOptions[0], BILLING_MIGRATION_CONFIRMATION],
  }
}

function reconciliationOptions(options) {
  const allowed = new Set([RECONCILIATION_CONFIRMATION, '--dry-run'])
  const accountOptions = options.filter((option) => option.startsWith(BILLING_ACCOUNT_OPTION))
  for (const option of options) {
    if (!allowed.has(option) && !option.startsWith(BILLING_ACCOUNT_OPTION)) {
      throw new Error('RevenueCat sandbox reconciliation received an unsupported option')
    }
  }
  if (accountOptions.length !== 1) {
    throw new Error('RevenueCat sandbox reconciliation requires exactly one --billing-account-id')
  }
  if (options.filter((option) => option === RECONCILIATION_CONFIRMATION).length !== 1) {
    throw new Error(`RevenueCat sandbox reconciliation requires ${RECONCILIATION_CONFIRMATION}`)
  }
  if (options.filter((option) => option === '--dry-run').length > 1) {
    throw new Error('RevenueCat sandbox reconciliation received duplicate --dry-run options')
  }

  const billingAccountId = accountOptions[0].slice(BILLING_ACCOUNT_OPTION.length)
  if (!billingAccountId.startsWith('billing_') || billingAccountId.length > 100 || billingAccountId.includes('/')) {
    throw new Error('RevenueCat sandbox reconciliation requires a valid canonical billing account ID')
  }
  return {
    dryRun: options.includes('--dry-run'),
    childArgs: [accountOptions[0], RECONCILIATION_CONFIRMATION],
  }
}

function legacyMigrationFixtureOptions(options) {
  const accountOptions = options.filter((option) => option.startsWith(BILLING_ACCOUNT_OPTION))
  const allowed = new Set([LEGACY_MIGRATION_FIXTURE_CONFIRMATION, '--dry-run'])
  if (options.some((option) => !allowed.has(option) && !option.startsWith(BILLING_ACCOUNT_OPTION))) {
    throw new Error('Legacy billing migration fixture received an unsupported option')
  }
  if (accountOptions.length !== 1) {
    throw new Error('Legacy billing migration fixture requires exactly one --billing-account-id')
  }
  if (options.filter((option) => option === LEGACY_MIGRATION_FIXTURE_CONFIRMATION).length !== 1) {
    throw new Error(`Legacy billing migration fixture requires ${LEGACY_MIGRATION_FIXTURE_CONFIRMATION}`)
  }
  if (options.filter((option) => option === '--dry-run').length > 1) {
    throw new Error('Legacy billing migration fixture received duplicate --dry-run options')
  }
  const billingAccountId = accountOptions[0].slice(BILLING_ACCOUNT_OPTION.length)
  if (!/^billing_[A-Za-z0-9_-]{8,100}$/.test(billingAccountId)) {
    throw new Error('Legacy billing migration fixture requires a valid canonical billing account ID')
  }
  return {
    dryRun: options.includes('--dry-run'),
    childArgs: [accountOptions[0], LEGACY_MIGRATION_FIXTURE_CONFIRMATION],
  }
}

function developmentBillingRotationOptions(options) {
  const accountOptions = options.filter((option) => option.startsWith(BILLING_ACCOUNT_OPTION))
  const allowed = new Set([DEVELOPMENT_BILLING_ROTATION_CONFIRMATION, '--dry-run'])
  if (options.some((option) => !allowed.has(option) && !option.startsWith(BILLING_ACCOUNT_OPTION))) {
    throw new Error('Development billing account rotation received an unsupported option')
  }
  if (accountOptions.length !== 1) {
    throw new Error('Development billing account rotation requires exactly one --billing-account-id')
  }
  if (options.filter((option) => option === DEVELOPMENT_BILLING_ROTATION_CONFIRMATION).length !== 1) {
    throw new Error(`Development billing account rotation requires ${DEVELOPMENT_BILLING_ROTATION_CONFIRMATION}`)
  }
  if (options.filter((option) => option === '--dry-run').length > 1) {
    throw new Error('Development billing account rotation received duplicate --dry-run options')
  }
  const billingAccountId = accountOptions[0].slice(BILLING_ACCOUNT_OPTION.length)
  if (!/^billing_[A-Za-z0-9_-]{8,100}$/.test(billingAccountId)) {
    throw new Error('Development billing account rotation requires a valid canonical billing account ID')
  }
  return {
    dryRun: options.includes('--dry-run'),
    childArgs: [accountOptions[0], DEVELOPMENT_BILLING_ROTATION_CONFIRMATION],
  }
}

export function resolveDevelopmentScriptOptions(name, options) {
  if (name === 'reconcile-revenuecat-sandbox') return reconciliationOptions(options)
  if (name === 'audit-billing-migration-candidates' || name === 'validate-billing-migration'
    || name === 'audit-billing-free-foundation') {
    return readOnlyOptions(name, options)
  }
  if (name === 'audit-billing-operational-control') return readOnlyOptions(name, options)
  if (name === 'prepare-billing-migration') return billingMigrationPreparationOptions(options)
  if (name === 'create-legacy-billing-migration-candidate') return legacyMigrationFixtureOptions(options)
  if (name === 'rotate-development-billing-account') return developmentBillingRotationOptions(options)
  if (name === 'reconcile-billing-free-foundation') return freeFoundationReconciliationOptions(options)
  if (name === 'assign-teams' && !options.includes('--confirm=assign-teams')) {
    throw new Error('assign-teams is destructive; repeat with --confirm=assign-teams')
  }
  if (name === 'approve-activate-billing-catalog' && !options.includes('--confirm=billing-catalog-development')) {
    throw new Error('Billing catalog activation requires --confirm=billing-catalog-development')
  }
  return { dryRun: options.includes('--dry-run'), childArgs: [] }
}

export const developmentScriptPolicyInternals = {
  BILLING_ACCOUNT_OPTION,
  DEVELOPMENT_BILLING_ROTATION_CONFIRMATION,
  BILLING_MIGRATION_CONFIRMATION,
  FREE_FOUNDATION_CONFIRMATION,
  INPUT_OPTION,
  LEGACY_MIGRATION_FIXTURE_CONFIRMATION,
  RECONCILIATION_CONFIRMATION,
}
