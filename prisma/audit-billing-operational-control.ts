import { createDevelopmentPrismaClient } from '../src/utils/developmentDatabase';
import {
  auditDevelopmentBillingOperationalControls,
  formatDevelopmentBillingOperationalControls,
} from '../src/modules/billing/operationalControlService';
import { getActiveBillingCatalog } from '../src/modules/billing/catalog';

async function main(): Promise<void> {
  if (process.argv.slice(2).length !== 0) throw new Error('Invalid protected operational control audit invocation');
  const prisma = createDevelopmentPrismaClient();
  try {
    const controls = await auditDevelopmentBillingOperationalControls(prisma);
    const catalog = await getActiveBillingCatalog(undefined, prisma);
    console.log(`${formatDevelopmentBillingOperationalControls(controls)}`
      + ` currentPurchasesEnabled=${catalog.purchasesEnabled}.`);
    if (controls.length !== 2 || controls.some(({ mode }) => mode !== 'PURCHASES_PAUSED')
      || catalog.purchasesEnabled) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error('Billing operational control audit failed: code=BILLING_OPERATIONAL_CONTROL_AUDIT_FAILED.');
  process.exitCode = 1;
});
