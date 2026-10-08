import { env } from '../../config/env';
import { logger } from '../../config/logger';
import type { PrismaClient } from '../../generated/prisma/client';
import type { BillingStoreName } from './types';

const GOOGLE_PLAY_SUBSCRIPTIONS_URL = 'https://play.google.com/store/account/subscriptions';
const APP_STORE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

const MANAGEABLE_PROVIDER_STATUSES = [
  'ACTIVE',
  'BILLING_RETRY',
  'STORE_GRACE',
  'ACCOUNT_HOLD',
  'PAUSED',
] as const;

export interface StoreSubscriptionManagement {
  url: string;
  store: BillingStoreName;
  storeProductId: string | null;
  willRenew: boolean | null;
}

type StoreManagementClient = Pick<PrismaClient, 'billingProviderSubscriptionChain'>;

interface ManageableSubscription {
  id: string;
  store: BillingStoreName;
  storeProductId: string | null;
  entitlementActive: boolean;
  providerStatusUpdatedAt: Date;
  willRenew: boolean | null;
}

export function storeSubscriptionManagementUrl(
  store: BillingStoreName,
  storeProductId: string | null,
): string {
  if (store === 'APPLE') return APP_STORE_SUBSCRIPTIONS_URL;
  const sku = storeProductId ? `sku=${encodeURIComponent(storeProductId)}&` : '';
  return `${GOOGLE_PLAY_SUBSCRIPTIONS_URL}?${sku}package=${encodeURIComponent(env.GOOGLE_PLAY_ANDROID_PACKAGE_ID)}`;
}

function pickManageableSubscription(
  subscriptions: readonly ManageableSubscription[],
): ManageableSubscription | null {
  return [...subscriptions].sort((left, right) => {
    if (left.entitlementActive !== right.entitlementActive) return left.entitlementActive ? -1 : 1;
    const leftStatusAt = left.providerStatusUpdatedAt.getTime();
    const rightStatusAt = right.providerStatusUpdatedAt.getTime();
    if (leftStatusAt !== rightStatusAt) return rightStatusAt - leftStatusAt;
    return right.id.localeCompare(left.id);
  })[0] ?? null;
}

export async function resolveSubscriptionManagement(
  billingAccountId: string | null,
  client: unknown,
): Promise<StoreSubscriptionManagement | null> {
  if (!billingAccountId) return null;
  if (!client || typeof client !== 'object' || !('billingProviderSubscriptionChain' in client)) return null;

  try {
    const chains = await (client as StoreManagementClient).billingProviderSubscriptionChain.findMany({
      where: { billingAccountId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        subscriptions: {
          where: {
            ownershipType: 'PURCHASED',
            OR: [
              { entitlementActive: true },
              { providerStatus: { in: [...MANAGEABLE_PROVIDER_STATUSES] } },
            ],
          },
          select: {
            id: true,
            store: true,
            currentStoreProductId: true,
            entitlementActive: true,
            providerStatusUpdatedAt: true,
            willRenew: true,
          },
        },
      },
    });

    const candidates: ManageableSubscription[] = chains.flatMap(({ subscriptions }) =>
      subscriptions.map((subscription) => ({
        id: subscription.id,
        store: subscription.store === 'APPLE' ? 'APPLE' : 'GOOGLE',
        storeProductId: subscription.currentStoreProductId,
        entitlementActive: subscription.entitlementActive,
        providerStatusUpdatedAt: subscription.providerStatusUpdatedAt,
        willRenew: subscription.willRenew,
      })));

    const selected = pickManageableSubscription(candidates);
    if (!selected) return null;

    return {
      url: storeSubscriptionManagementUrl(selected.store, selected.storeProductId),
      store: selected.store,
      storeProductId: selected.storeProductId,
      willRenew: selected.willRenew,
    };
  } catch (cause) {
    logger.warn({
      event: 'billing.store_management_resolution_failed',
      billingAccountId,
      causeType: cause instanceof Error ? cause.name : typeof cause,
    }, 'Failed to resolve store subscription management url');
    return null;
  }
}
