import { describe, expect, it } from 'vitest';
import { billingEvidenceHash, providerEvidenceInternals } from './providerEvidence';

describe('billing provider evidence', () => {
  it('is deterministic across object key order', () => {
    expect(billingEvidenceHash('test', { b: 2, a: 'one' }))
      .toBe(billingEvidenceHash('test', { a: 'one', b: 2 }));
  });

  it('distinguishes null, empty strings, arrays, and namespaces', () => {
    const values = [
      billingEvidenceHash('one', null),
      billingEvidenceHash('one', ''),
      billingEvidenceHash('one', []),
      billingEvidenceHash('two', null),
    ];
    expect(new Set(values).size).toBe(values.length);
  });

  it('uses UTF-8 byte lengths and rejects non-finite numbers', () => {
    expect(providerEvidenceInternals.canonicalize('México')).toBe('s7:México');
    expect(() => providerEvidenceInternals.canonicalize(Number.NaN)).toThrow('finite');
  });
});
