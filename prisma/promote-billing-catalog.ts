import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertBillingCatalogPromotionContext,
  createBillingCatalogPromotionPrismaClient,
} from '../src/utils/catalogPromotionDatabase';

const VERSION = '2026-09-mx-v1';
const MANIFEST_OPTION = `--manifest=${VERSION}`;
const HASH_OPTION = '--manifest-sha256=';

function parseInvocation(args: string[]) {
  const [action, target, ...options] = args;
  if (!['load', 'activate'].includes(action) || !['preview', 'production'].includes(target)) {
    throw new Error('Invalid protected billing catalog promotion invocation');
  }
  const typedAction = action as 'load' | 'activate';
  const typedTarget = target as 'preview' | 'production';
  const confirmation = `--confirm=billing-catalog-${typedTarget}-${typedAction}`;
  const productionConfirmations = typedTarget === 'production'
    ? ['--confirm=production', '--confirm-snapshot'] : [];
  const hashOptions = options.filter((option) => option.startsWith(HASH_OPTION));
  const required = [MANIFEST_OPTION, confirmation, ...productionConfirmations];
  if (hashOptions.length !== 1 || required.some((option) => options.filter((value) => value === option).length !== 1)
    || options.length !== required.length + 1) {
    throw new Error('Invalid protected billing catalog promotion invocation');
  }
  const expectedHash = hashOptions[0].slice(HASH_OPTION.length);
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) throw new Error('Approved billing catalog manifest hash mismatch');
  return { action: typedAction, target: typedTarget, expectedHash };
}

async function main(): Promise<void> {
  const invocation = parseInvocation(process.argv.slice(2));
  assertBillingCatalogPromotionContext(invocation.target);
  const [catalog, catalogAudit, catalogDraft, manifestModule] = await Promise.all([
    import('../src/modules/billing/catalog'),
    import('../src/modules/billing/catalogAudit'),
    import('../src/modules/billing/catalogDraft'),
    import('../src/modules/billing/manifests/mx-2026-09-v1'),
  ]);
  const manifest = manifestModule.MX_2026_09_V1_CATALOG_MANIFEST;
  if (catalogDraft.catalogManifestSha256(manifest) !== invocation.expectedHash) {
    throw new Error('Approved billing catalog manifest hash mismatch');
  }
  const environment = invocation.target === 'production' ? 'PRODUCTION' : 'PREVIEW';
  const prisma = createBillingCatalogPromotionPrismaClient(invocation.target);
  try {
    if (invocation.action === 'load') {
      const result = await catalogDraft.loadCatalogManifestDraft(prisma, environment, manifest);
      console.log(`Billing catalog ${result.version} ready as DRAFT-compatible with ${result.productCount} products.`);
      return;
    }

    const evidencePath = resolve(process.cwd(), 'docs/billing/pricing/2026-09-mx-v1.json');
    const evidence = catalogAudit.billingCatalogPricingEvidenceSchema.parse(JSON.parse(readFileSync(evidencePath, 'utf8')));
    if (evidence.status !== 'APPROVED' || !evidence.approvedOn) {
      throw new Error('Pricing evidence must be APPROVED before catalog activation.');
    }
    catalogAudit.auditCatalogPricingEvidence(manifest, evidence);
    const approved = await catalogDraft.approveCatalogManifestRelease(prisma, environment, manifest);
    if (approved.status === 'DRAFT') await catalog.activateCatalogRelease(approved.id, prisma);
    const activeCatalog = await catalog.getActiveBillingCatalog(environment, prisma);
    if (!activeCatalog.available || activeCatalog.release?.id !== approved.id
      || activeCatalog.release.products.length !== 84) {
      throw new Error('Activated catalog verification failed.');
    }
    console.log(`Billing catalog ${activeCatalog.release.version} is ACTIVE in ${invocation.target} with 84 products.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error('Billing catalog promotion failed: code=BILLING_CATALOG_PROMOTION_FAILED.');
  process.exitCode = 1;
});
