import { createHash } from 'node:crypto';

export type BillingEvidenceValue = null | boolean | number | string
  | BillingEvidenceValue[] | { [key: string]: BillingEvidenceValue };

function canonicalize(value: BillingEvidenceValue): string {
  if (value === null) return 'n';
  if (typeof value === 'boolean') return value ? 'b1' : 'b0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Billing evidence numbers must be finite');
    return `d${value}`;
  }
  if (typeof value === 'string') return `s${Buffer.byteLength(value, 'utf8')}:${value}`;
  if (Array.isArray(value)) return `a${value.length}:[${value.map(canonicalize).join('')}]`;

  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `o${entries.length}:{${entries.map(([key, item]) => `${canonicalize(key)}${canonicalize(item)}`).join('')}}`;
}

export function billingEvidenceHash(namespace: string, value: BillingEvidenceValue): string {
  const canonical = canonicalize({ namespace, version: 1, value });
  return createHash('sha256').update(canonical).digest('hex');
}

export const providerEvidenceInternals = { canonicalize };
