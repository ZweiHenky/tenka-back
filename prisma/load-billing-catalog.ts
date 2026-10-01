import { loadCatalogManifestDraft } from '../src/modules/billing/catalogDraft';
import { MX_2026_09_V1_CATALOG_MANIFEST } from '../src/modules/billing/manifests/mx-2026-09-v1';
import { createDevelopmentPrismaClient } from '../src/utils/developmentDatabase';

const prisma = createDevelopmentPrismaClient();

async function main(): Promise<void> {
  const result = await loadCatalogManifestDraft(prisma, 'PREVIEW', MX_2026_09_V1_CATALOG_MANIFEST);
  console.log(`Billing catalog ${result.version} ready as DRAFT with ${result.productCount} products (${result.id}).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Billing catalog load failed');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
