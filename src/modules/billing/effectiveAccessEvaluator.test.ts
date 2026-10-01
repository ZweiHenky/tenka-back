import { describe, expect, it } from 'vitest';
import {
  evaluateStoreEffectiveAccess,
  type StoreBillingSourceCandidate,
} from './effectiveAccessEvaluator';

const END = new Date('2026-10-01T00:00:00.000Z');
const NOW = new Date('2026-09-01T00:00:00.000Z');

function source(overrides: Partial<StoreBillingSourceCandidate> = {}): StoreBillingSourceCandidate {
  return {
    id: 'source-a',
    chainId: 'chain-a',
    providerStatus: 'ACTIVE',
    entitlementActive: true,
    ownershipType: 'PURCHASED',
    canonicalEvidenceReference: 'evidence-a',
    currentCapacity: 5,
    willRenew: true,
    providerAccessEndsAt: END,
    providerEndReason: null,
    eligibleForContinuedAccess: true,
    eligibleForNewAccess: true,
    eligibleForLocalGrace: false,
    ...overrides,
  };
}

function evaluate(
  candidates: ReadonlyArray<StoreBillingSourceCandidate>,
  previousPrimaryChainId: string | null = null,
) {
  return evaluateStoreEffectiveAccess({ candidates, previousPrimaryChainId, now: NOW });
}

describe('store effective access evaluator', () => {
  it('returns NONE when there are no sources or only inactive entitlements', () => {
    expect(evaluate([])).toEqual({ state: 'NONE', eligibleSourceIds: [] });
    expect(evaluate([
      source({ entitlementActive: false, eligibleForContinuedAccess: false }),
      source({ id: 'source-b', chainId: 'chain-b', entitlementActive: false, eligibleForContinuedAccess: false, ownershipType: 'FAMILY_SHARED' }),
    ])).toEqual({ state: 'NONE', eligibleSourceIds: [] });
  });

  it.each([
    ['non-access-bearing status', { providerStatus: 'UNKNOWN' as const }],
    ['family-shared ownership', { ownershipType: 'FAMILY_SHARED' as const }],
    ['unknown ownership', { ownershipType: 'UNKNOWN' as const }],
    ['missing canonical evidence', { canonicalEvidenceReference: null }],
    ['empty canonical evidence', { canonicalEvidenceReference: '' }],
    ['missing capacity', { currentCapacity: null }],
    ['zero capacity', { currentCapacity: 0 }],
    ['negative capacity', { currentCapacity: -1 }],
    ['fractional capacity', { currentCapacity: 2.5 }],
  ])('returns BLOCKED for an active entitlement with %s', (_name, overrides) => {
    expect(evaluate([source(overrides)])).toEqual({ state: 'BLOCKED', eligibleSourceIds: [] });
  });

  it.each([
    'ACCOUNT_HOLD',
    'EXPIRED',
    'REVOKED',
  ] as const)('does not treat %s as an active canonical source', (providerStatus) => {
    expect(evaluate([source({ providerStatus })])).toEqual({ state: 'BLOCKED', eligibleSourceIds: [] });
  });

  it('does not select a source whose known access end has passed', () => {
    expect(evaluate([source({ providerAccessEndsAt: new Date('2026-08-31T23:59:59Z') })]))
      .toEqual({ state: 'BLOCKED', eligibleSourceIds: [] });
  });

  it.each([
    'ACTIVE',
    'BILLING_RETRY',
    'STORE_GRACE',
    'PAUSED',
  ] as const)('accepts active canonical purchased source status %s', (providerStatus) => {
    expect(evaluate([source({ providerStatus })])).toMatchObject({
      state: 'ACTIVE', primarySourceId: 'source-a', capacity: 5,
    });
  });

  it('filters ineligible sources without blocking a valid active source', () => {
    const result = evaluate([
      source({ id: 'family', chainId: 'chain-family', currentCapacity: 15, ownershipType: 'FAMILY_SHARED' }),
      source({ id: 'expired', chainId: 'chain-expired', currentCapacity: 15, entitlementActive: false, eligibleForContinuedAccess: false }),
      source({ id: 'valid', chainId: 'chain-valid', currentCapacity: 2 }),
    ]);

    expect(result).toEqual({
      state: 'ACTIVE',
      primarySourceId: 'valid',
      primaryChainId: 'chain-valid',
      capacity: 2,
      eligibleSourceIds: ['valid'],
    });
  });

  it('chooses greater capacity and never sums eligible sources', () => {
    const result = evaluate([
      source({ id: 'capacity-5', chainId: 'chain-5', currentCapacity: 5 }),
      source({ id: 'capacity-8', chainId: 'chain-8', currentCapacity: 8 }),
    ]);

    expect(result).toEqual({
      state: 'ACTIVE',
      primarySourceId: 'capacity-8',
      primaryChainId: 'chain-8',
      capacity: 8,
      eligibleSourceIds: ['capacity-5', 'capacity-8'],
    });
  });

  it.each([
    [false, null],
    [null, false],
  ] as const)('prefers willRenew=true over %s and treats false/null equally', (otherRenewal, equivalentRenewal) => {
    const renewing = source({ id: 'renewing', chainId: 'chain-z', willRenew: true });
    const other = source({ id: 'other', chainId: 'chain-a', willRenew: otherRenewal });
    expect(evaluate([other, renewing])).toMatchObject({ primarySourceId: 'renewing' });

    const equalA = source({ id: 'equal-a', chainId: 'chain-a', willRenew: otherRenewal });
    const equalB = source({ id: 'equal-b', chainId: 'chain-b', willRenew: equivalentRenewal });
    expect(evaluate([equalB, equalA])).toMatchObject({ primarySourceId: 'equal-a' });
  });

  it('prefers the later access end and ranks null or invalid dates last', () => {
    const later = source({ id: 'later', chainId: 'chain-z', providerAccessEndsAt: new Date('2026-11-01T00:00:00Z') });
    const earlier = source({ id: 'earlier', chainId: 'chain-a', providerAccessEndsAt: END });
    expect(evaluate([earlier, later])).toMatchObject({ primarySourceId: 'later' });

    const missing = source({ id: 'missing', chainId: 'chain-a', providerAccessEndsAt: null });
    expect(evaluate([missing, earlier])).toMatchObject({ primarySourceId: 'earlier' });

    const invalid = source({ id: 'invalid', chainId: 'chain-a', providerAccessEndsAt: new Date(Number.NaN) });
    expect(evaluate([invalid, earlier])).toMatchObject({ primarySourceId: 'earlier' });
  });

  it('keeps the previous primary chain after capacity, renewal, and end remain tied', () => {
    const previous = source({ id: 'previous', chainId: 'chain-z' });
    const other = source({ id: 'other', chainId: 'chain-a' });

    expect(evaluate([other, previous], 'chain-z')).toMatchObject({ primarySourceId: 'previous' });

    const previousWithoutEnd = source({
      id: 'previous-without-end', chainId: 'chain-z', providerAccessEndsAt: null,
    });
    const otherWithoutEnd = source({
      id: 'other-without-end', chainId: 'chain-a', providerAccessEndsAt: null,
    });
    expect(evaluate([otherWithoutEnd, previousWithoutEnd], 'chain-z'))
      .toMatchObject({ primarySourceId: 'previous-without-end' });
  });

  it('uses stable chain ID as the final cross-chain tie-breaker', () => {
    const chainB = source({ id: 'source-b', chainId: 'chain-b' });
    const chainA = source({ id: 'source-z', chainId: 'chain-a' });

    expect(evaluate([chainB, chainA])).toMatchObject({ primarySourceId: 'source-z' });
    expect(evaluate([chainA, chainB])).toMatchObject({ primarySourceId: 'source-z' });
  });

  it('uses source ID only to make duplicate candidates in one chain deterministic', () => {
    const sourceB = source({ id: 'source-b' });
    const sourceA = source({ id: 'source-a' });

    expect(evaluate([sourceB, sourceA])).toMatchObject({ primarySourceId: 'source-a' });
    expect(evaluate([sourceA, sourceB])).toMatchObject({ primarySourceId: 'source-a' });
  });

  it('applies ranking criteria in order rather than allowing later criteria to win', () => {
    const result = evaluate([
      source({
        id: 'higher-capacity', chainId: 'chain-z', currentCapacity: 8,
        willRenew: false, providerAccessEndsAt: null,
      }),
      source({
        id: 'otherwise-preferred', chainId: 'chain-a', currentCapacity: 5,
        willRenew: true, providerAccessEndsAt: new Date('2099-01-01T00:00:00Z'),
      }),
    ], 'chain-a');

    expect(result).toMatchObject({ primarySourceId: 'higher-capacity', capacity: 8 });
  });

  it('returns all and only eligible source IDs in stable order without mutating input', () => {
    const candidates = [
      source({ id: 'source-z', chainId: 'chain-z' }),
      source({ id: 'source-blocked', chainId: 'chain-b', canonicalEvidenceReference: null }),
      source({ id: 'source-a', chainId: 'chain-a' }),
    ];
    const originalOrder = candidates.map(({ id }) => id);

    expect(evaluate(candidates)).toMatchObject({ eligibleSourceIds: ['source-a', 'source-z'] });
    expect(candidates.map(({ id }) => id)).toEqual(originalOrder);
  });

  it('proposes local grace only for recognized inactive billing failure evidence', () => {
    expect(evaluate([source({
      entitlementActive: false,
      eligibleForContinuedAccess: false,
      eligibleForNewAccess: false,
      eligibleForLocalGrace: true,
      providerStatus: 'EXPIRED',
      providerEndReason: 'BILLING_FAILURE',
    })])).toMatchObject({
      state: 'LOCAL_GRACE_CANDIDATE',
      primarySourceId: 'source-a',
      graceStartedAt: END,
      graceReason: 'BILLING_FAILURE',
    });
  });

  it('keeps an active canonical source ahead of a failed higher-capacity source', () => {
    expect(evaluate([
      source({
        id: 'failed', chainId: 'failed-chain', currentCapacity: 15,
        entitlementActive: false, eligibleForContinuedAccess: false, eligibleForNewAccess: false,
        eligibleForLocalGrace: true, providerStatus: 'EXPIRED', providerEndReason: 'BILLING_FAILURE',
      }),
      source({ id: 'active', chainId: 'active-chain', currentCapacity: 2 }),
    ])).toMatchObject({ state: 'ACTIVE', primarySourceId: 'active', capacity: 2 });
  });
});
