import type {
  BillingProviderEndReasonName,
  BillingOwnershipTypeName,
  BillingProviderStatusName,
} from './providerNormalizer';

export interface StoreBillingSourceCandidate {
  id: string;
  chainId: string;
  providerStatus: BillingProviderStatusName;
  entitlementActive: boolean;
  ownershipType: BillingOwnershipTypeName;
  canonicalEvidenceReference: string | null;
  currentCapacity: number | null;
  willRenew: boolean | null;
  providerAccessEndsAt: Date | null;
  providerEndReason: BillingProviderEndReasonName | null;
  eligibleForContinuedAccess: boolean;
  eligibleForNewAccess: boolean;
  eligibleForLocalGrace: boolean;
}

interface StoreAccessProposalBase {
  eligibleSourceIds: string[];
}

export interface NoStoreAccessProposal extends StoreAccessProposalBase {
  state: 'NONE';
}

export interface BlockedStoreAccessProposal extends StoreAccessProposalBase {
  state: 'BLOCKED';
}

export interface ActiveStoreAccessProposal extends StoreAccessProposalBase {
  state: 'ACTIVE';
  primarySourceId: string;
  primaryChainId: string;
  capacity: number;
}

export interface LocalGraceStoreAccessProposal extends StoreAccessProposalBase {
  state: 'LOCAL_GRACE_CANDIDATE';
  primarySourceId: string;
  primaryChainId: string;
  graceStartedAt: Date;
  graceReason: 'BILLING_FAILURE';
}

export type StoreAccessProposal =
  | NoStoreAccessProposal
  | BlockedStoreAccessProposal
  | LocalGraceStoreAccessProposal
  | ActiveStoreAccessProposal;

const ACCESS_BEARING_STATUSES = new Set<BillingProviderStatusName>([
  'ACTIVE',
  'BILLING_RETRY',
  'STORE_GRACE',
  'PAUSED',
]);

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isEligible(source: StoreBillingSourceCandidate, now: Date): source is StoreBillingSourceCandidate & {
  currentCapacity: number;
} {
  return source.entitlementActive
    && source.eligibleForContinuedAccess
    && ACCESS_BEARING_STATUSES.has(source.providerStatus)
    && source.ownershipType === 'PURCHASED'
    && source.canonicalEvidenceReference !== null
    && source.canonicalEvidenceReference.length > 0
    && source.currentCapacity !== null
    && Number.isInteger(source.currentCapacity)
    && source.currentCapacity > 0
    && (source.providerAccessEndsAt === null || source.providerAccessEndsAt > now);
}

function accessEndValue(value: Date | null): number {
  if (value === null) return Number.NEGATIVE_INFINITY;
  const milliseconds = value.getTime();
  return Number.isNaN(milliseconds) ? Number.NEGATIVE_INFINITY : milliseconds;
}

export function evaluateStoreEffectiveAccess(input: {
  candidates: ReadonlyArray<StoreBillingSourceCandidate>;
  previousPrimaryChainId: string | null;
  now: Date;
}): StoreAccessProposal {
  const eligible = input.candidates.filter((source) => isEligible(source, input.now));
  const eligibleSourceIds = eligible.map(({ id }) => id).sort(stableCompare);

  if (eligible.length === 0) {
    if (input.candidates.some(({ entitlementActive }) => entitlementActive)) {
      return { state: 'BLOCKED', eligibleSourceIds };
    }
    const graceCandidates = input.candidates
      .filter((source): source is StoreBillingSourceCandidate & { providerAccessEndsAt: Date } =>
        source.eligibleForLocalGrace
        && source.ownershipType === 'PURCHASED'
        && Boolean(source.canonicalEvidenceReference)
        && source.providerAccessEndsAt !== null
        && !Number.isNaN(source.providerAccessEndsAt.getTime()))
      .sort((left, right) => {
        const previousPrimary = Number(right.chainId === input.previousPrimaryChainId)
          - Number(left.chainId === input.previousPrimaryChainId);
        if (previousPrimary !== 0) return previousPrimary;
        const end = right.providerAccessEndsAt.getTime() - left.providerAccessEndsAt.getTime();
        if (end !== 0) return end;
        const chain = stableCompare(left.chainId, right.chainId);
        return chain !== 0 ? chain : stableCompare(left.id, right.id);
      });
    const grace = graceCandidates[0];
    return grace ? {
      state: 'LOCAL_GRACE_CANDIDATE',
      primarySourceId: grace.id,
      primaryChainId: grace.chainId,
      graceStartedAt: grace.providerAccessEndsAt,
      graceReason: 'BILLING_FAILURE',
      eligibleSourceIds,
    } : { state: 'NONE', eligibleSourceIds };
  }

  const ranked = [...eligible].sort((left, right) => {
    const capacity = right.currentCapacity - left.currentCapacity;
    if (capacity !== 0) return capacity;

    const renewal = Number(right.willRenew === true) - Number(left.willRenew === true);
    if (renewal !== 0) return renewal;

    const leftAccessEnd = accessEndValue(left.providerAccessEndsAt);
    const rightAccessEnd = accessEndValue(right.providerAccessEndsAt);
    if (leftAccessEnd !== rightAccessEnd) return rightAccessEnd > leftAccessEnd ? 1 : -1;

    const previousPrimary = Number(right.chainId === input.previousPrimaryChainId)
      - Number(left.chainId === input.previousPrimaryChainId);
    if (previousPrimary !== 0) return previousPrimary;

    const chain = stableCompare(left.chainId, right.chainId);
    return chain !== 0 ? chain : stableCompare(left.id, right.id);
  });
  const primary = ranked[0];

  return {
    state: 'ACTIVE',
    primarySourceId: primary.id,
    primaryChainId: primary.chainId,
    capacity: primary.currentCapacity,
    eligibleSourceIds,
  };
}
