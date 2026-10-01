import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { activateCatalogRelease, getActiveBillingCatalog } from '../src/modules/billing/catalog';
import { auditCatalogPricingEvidence, billingCatalogPricingEvidenceSchema } from '../src/modules/billing/catalogAudit';
import { approveCatalogManifestRelease } from '../src/modules/billing/catalogDraft';
import { MX_2026_09_V1_CATALOG_MANIFEST } from '../src/modules/billing/manifests/mx-2026-09-v1';
import { createDevelopmentPrismaClient } from '../src/utils/developmentDatabase';

const prisma = createDevelopmentPrismaClient();

async function main(): Promise<void> {
  const evidencePath = resolve(process.cwd(), 'docs/billing/pricing/2026-09-mx-v1.json');
  const evidence = billingCatalogPricingEvidenceSchema.parse(JSON.parse(readFileSync(evidencePath, 'utf8')));
  if (evidence.status !== 'APPROVED' || !evidence.approvedOn) {
    throw new Error('Pricing evidence must be APPROVED before catalog activation.');
  }
  auditCatalogPricingEvidence(MX_2026_09_V1_CATALOG_MANIFEST, evidence);

  const approved = await approveCatalogManifestRelease(prisma, 'PREVIEW', MX_2026_09_V1_CATALOG_MANIFEST);
  if (approved.status === 'DRAFT') await activateCatalogRelease(approved.id, prisma);

  const catalog = await getActiveBillingCatalog('PREVIEW', prisma);
  if (!catalog.available || catalog.release?.id !== approved.id
    || catalog.release.products.length !== 84 || catalog.purchasesEnabled !== false) {
    throw new Error('Activated catalog verification failed.');
  }
  console.log(`Billing catalog ${catalog.release.version} is ACTIVE in development with 84 products and purchasesEnabled=false.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Billing catalog activation failed');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
