import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditCatalogPricingEvidence } from '../modules/billing/catalogAudit';
import { MX_2026_09_V1_CATALOG_MANIFEST } from '../modules/billing/manifests/mx-2026-09-v1';

const evidencePath = resolve(process.cwd(), 'docs/billing/pricing/2026-09-mx-v1.json');
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as unknown;
const report = auditCatalogPricingEvidence(MX_2026_09_V1_CATALOG_MANIFEST, evidence);

console.log(`Billing catalog audit passed: ${report.commercialVariantCount} commercial variants, ${report.physicalProductCount} physical products, maximum Apple variance ${report.maxAppleVariancePercent}%.`);
