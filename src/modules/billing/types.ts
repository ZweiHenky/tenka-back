import type { UserRole } from '../../types/auth';

export type AccountAccessKind = 'ADMIN' | 'ENTERPRISE' | 'PAID' | 'FREE_LIGA' | 'CAPITAN';
export type EffectiveBillingAccess = 'FREE' | 'PAID' | 'LOCAL_GRACE' | 'MIGRATION' | 'ENTERPRISE' | 'ADMIN';

export interface FreeManagementGrantSummary {
  divisionId: string;
  divisionName: string;
  leagueId: string;
  leagueName: string;
  grantedAt: Date;
}

export interface AccountAccessPolicy {
  role: UserRole;
  accessKind: AccountAccessKind;
  effectiveAccess: EffectiveBillingAccess;
  billingAccountId: string | null;
  effectiveCapacity: number;
  ownedTeamLimit: number | null;
  ownedLeagueLimit: number | null;
  ownedDivisionLimit: number | null;
  activeDivisionLimit: number | null;
  canConsumePaidSlot: boolean;
  freeDivisionId: string | null;
  freeManagementGrant: FreeManagementGrantSummary | null;
  migrationOverlayActive?: boolean;
  migrationDeadline?: Date | null;
  migrationPaused?: boolean;
  migrationSelectedDivisionId?: string | null;
  migrationDivisions?: Array<{ id: string; name: string; leagueName: string }>;
}

export interface StoreSubscriptionManagementDto {
  url: string;
  store: BillingStoreName;
  storeProductId: string | null;
  willRenew: boolean | null;
}

export type BillingChangeDirectionName = 'UPGRADE' | 'DOWNGRADE' | 'SAME';
export type BillingChangeTimingName = 'IMMEDIATE' | 'DEFERRED' | 'TWO_STEP';
export type BillingChangeOperationStatusName =
  | 'DRAFT'
  | 'FIRST_PURCHASE_PENDING'
  | 'FIRST_VERIFICATION_PENDING'
  | 'FIRST_VERIFIED'
  | 'SECOND_STEP_PENDING'
  | 'SCHEDULED'
  | 'COMPLETED'
  | 'CANCELED'
  | 'ABANDONED';

export interface BillingChangeVariantDto {
  variantId: string;
  logicalProductId: string;
  billingInterval: BillingIntervalName;
  capacity: number;
  storeProductId: string;
}

export interface BillingActiveChangeOperationDto {
  id: string;
  status: BillingChangeOperationStatusName;
  version: number;
  lastErrorCode: string | null;
  current: BillingChangeVariantDto;
  target: BillingChangeVariantDto;
  firstStep: BillingChangeVariantDto;
  direction: 'UPGRADE';
  timing: 'TWO_STEP';
  requiresRenewalSelection: false;
  activeAttempt: {
    id: string;
    status: string;
    purpose: 'PRODUCT_CHANGE_FIRST_STEP' | 'PRODUCT_CHANGE_FINAL_STEP';
    version: number;
  } | null;
}

export interface BillingStateDto {
  role: UserRole;
  effectiveAccess: EffectiveBillingAccess;
  billingAccountId: string | null;
  revenueCatAppUserId: string | null;
  effectiveCapacity: number;
  limits: {
    teams: number | null;
    leagues: number | null;
    divisions: number | null;
  };
  freeManagementGrant: FreeManagementGrantSummary | null;
  purchasesEnabled: boolean;
  subscriptionManagement: StoreSubscriptionManagementDto | null;
  nextAction?: 'PURCHASE_FIRST_STEP' | 'WAIT_FOR_FIRST_VERIFICATION' | 'SCHEDULE_PERIOD_CHANGE' | 'WAIT_FOR_SCHEDULE_VERIFICATION' | null;
  activeChangeOperation?: BillingActiveChangeOperationDto | null;
  migrationOverlayActive?: boolean;
  migrationDeadline?: Date | null;
  migrationPaused?: boolean;
  migrationSelectedDivisionId?: string | null;
  migrationDivisions?: Array<{ id: string; name: string; leagueName: string }>;
}

export type BillingStoreName = 'APPLE' | 'GOOGLE';
export type BillingIntervalName = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
export type BillingEnvironmentName = 'PREVIEW' | 'PRODUCTION';

export interface BillingCatalogProductInput {
  id?: string;
  logicalProductId: string;
  store: BillingStoreName;
  storeProductId: string;
  basePlanId: string | null;
  revenueCatOfferingId: string;
  revenueCatPackageId: string;
  revenueCatProductIdentifier: string;
  capacity: number;
  billingInterval: BillingIntervalName;
  intervalMonths: number;
  active: boolean;
}

export interface BillingCatalogManifest {
  version: string;
  entitlementId: string;
  territories: readonly string[];
  products: ReadonlyArray<BillingCatalogProductInput>;
}

export interface BillingCatalogDto {
  available: boolean;
  environment: BillingEnvironmentName;
  release: null | {
    id: string;
    version: string;
    products: BillingCatalogProductInput[];
  };
  purchasesEnabled: boolean;
}

export type BillingPurchaseSelectionStatusName = 'DRAFT' | 'LOCKED' | 'APPLIED' | 'SUPERSEDED';

export interface BillingPurchaseSelectionDto {
  id: string;
  logicalProductId: string;
  billingInterval: BillingIntervalName;
  targetCapacity: number;
  status: BillingPurchaseSelectionStatusName;
  version: number;
  lockedAt: Date | null;
  items: Array<{
    slotNumber: number;
    divisionId: string;
    fixedByFreeGrant: boolean;
  }>;
  createdAt: Date;
  updatedAt: Date;
}
