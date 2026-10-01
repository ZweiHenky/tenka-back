import { z } from 'zod';
import { ValidationError } from '../../utils/errors';
import { validateCatalogProducts } from './catalog';
import type { BillingCatalogManifest } from './types';

const storePriceSchema = z.object({
  targetCustomerPriceMxn: z.number().positive(),
  appleCustomerPriceMxn: z.number().positive(),
  googleConfiguredPriceBeforeTaxMxn: z.number().positive(),
  googleExpectedCustomerPriceMxn: z.number().positive(),
});

export const billingCatalogPricingEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  catalogVersion: z.string().min(1),
  status: z.enum(['DRAFT', 'APPROVED']),
  approvedOn: z.string().date().optional(),
  currency: z.literal('MXN'),
  territories: z.tuple([z.literal('MX')]),
  priceBasis: z.object({
    monthlyCustomerPricePerDivision: z.literal(129),
    quarterlyDiscountPercent: z.literal(10),
    annualDiscountPercent: z.literal(20),
    googleAssumedTaxPercent: z.literal(16),
    googleConfiguredPricesExcludeTax: z.literal(true),
    appleCustomerPricesIncludeApplicableTax: z.literal(true),
  }),
  unresolvedIssues: z.array(z.unknown()),
  capacities: z.array(z.object({
    capacity: z.number().int().min(2).max(15),
    prices: z.object({
      monthly: storePriceSchema,
      quarterly: storePriceSchema,
      annual: storePriceSchema,
    }),
  })).length(14),
});

export type BillingCatalogPricingEvidence = z.infer<typeof billingCatalogPricingEvidenceSchema>;

const PERIODS = [
  { key: 'monthly' as const, months: 1, discountPercent: 0 },
  { key: 'quarterly' as const, months: 3, discountPercent: 10 },
  { key: 'annual' as const, months: 12, discountPercent: 20 },
];

function assertAudit(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ValidationError(message);
}

function closeTo(left: number, right: number, tolerance = 0.011): boolean {
  return Math.abs(left - right) <= tolerance;
}

export function auditCatalogPricingEvidence(
  manifest: BillingCatalogManifest,
  input: unknown,
): { commercialVariantCount: number; physicalProductCount: number; maxAppleVariancePercent: number } {
  const evidence = billingCatalogPricingEvidenceSchema.parse(input);
  validateCatalogProducts(manifest.products);
  assertAudit(evidence.catalogVersion === manifest.version, 'La evidencia no corresponde a la version del manifest');
  assertAudit(evidence.unresolvedIssues.length === 0, 'La evidencia conserva problemas de precio sin resolver');
  assertAudit(manifest.territories.length === 1 && manifest.territories[0] === 'MX', 'El manifest debe limitarse a Mexico');

  for (const product of manifest.products) {
    const forbiddenField = Object.keys(product).find((key) => /price|currency|tax/i.test(key));
    assertAudit(!forbiddenField, `El manifest runtime contiene el campo comercial ${forbiddenField}`);
  }

  const observedCapacities = new Set<number>();
  const previousApplePrice = { monthly: 0, quarterly: 0, annual: 0 };
  let maxAppleVariancePercent = 0;

  for (const row of [...evidence.capacities].sort((left, right) => left.capacity - right.capacity)) {
    assertAudit(!observedCapacities.has(row.capacity), `La evidencia repite la capacidad ${row.capacity}`);
    observedCapacities.add(row.capacity);
    const monthlyTarget = row.capacity * evidence.priceBasis.monthlyCustomerPricePerDivision;

    for (const period of PERIODS) {
      const price = row.prices[period.key];
      const target = monthlyTarget * period.months * (1 - period.discountPercent / 100);
      assertAudit(closeTo(price.targetCustomerPriceMxn, target), `El objetivo ${period.key} de capacidad ${row.capacity} no respeta la formula aprobada`);
      assertAudit(closeTo(price.googleExpectedCustomerPriceMxn, target), `El precio Google esperado ${period.key} de capacidad ${row.capacity} no respeta el objetivo`);

      const googleWithTax = price.googleConfiguredPriceBeforeTaxMxn
        * (1 + evidence.priceBasis.googleAssumedTaxPercent / 100);
      assertAudit(closeTo(googleWithTax, price.googleExpectedCustomerPriceMxn, 0.02), `El precio Google antes de impuestos ${period.key} de capacidad ${row.capacity} es inconsistente`);

      const appleVariancePercent = Math.abs(price.appleCustomerPriceMxn - price.googleExpectedCustomerPriceMxn)
        / price.googleExpectedCustomerPriceMxn * 100;
      assertAudit(appleVariancePercent <= 5, `Apple y Google difieren mas de 5% en ${period.key} para capacidad ${row.capacity}`);
      maxAppleVariancePercent = Math.max(maxAppleVariancePercent, appleVariancePercent);

      assertAudit(price.appleCustomerPriceMxn > previousApplePrice[period.key], `El precio Apple ${period.key} no aumenta en capacidad ${row.capacity}`);
      previousApplePrice[period.key] = price.appleCustomerPriceMxn;
    }

    const quarterlyDiscount = (1 - row.prices.quarterly.appleCustomerPriceMxn / (row.prices.monthly.appleCustomerPriceMxn * 3)) * 100;
    const annualDiscount = (1 - row.prices.annual.appleCustomerPriceMxn / (row.prices.monthly.appleCustomerPriceMxn * 12)) * 100;
    assertAudit(quarterlyDiscount >= 8 && quarterlyDiscount <= 12, `El descuento trimestral Apple queda fuera de 8%-12% en capacidad ${row.capacity}`);
    assertAudit(annualDiscount >= 18 && annualDiscount <= 22, `El descuento anual Apple queda fuera de 18%-22% en capacidad ${row.capacity}`);
  }

  assertAudit(observedCapacities.size === 14, 'La evidencia no cubre las capacidades 2 a 15');
  for (let capacity = 2; capacity <= 15; capacity += 1) {
    assertAudit(observedCapacities.has(capacity), `La evidencia no contiene la capacidad ${capacity}`);
  }

  return {
    commercialVariantCount: evidence.capacities.length * PERIODS.length,
    physicalProductCount: manifest.products.length,
    maxAppleVariancePercent: Math.round(maxAppleVariancePercent * 100) / 100,
  };
}
