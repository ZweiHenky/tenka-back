import type { z } from 'zod';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { Sentry } from '../../instrument';
import { assertDevelopmentScriptContext } from '../../utils/developmentDatabase';
import {
  revenueCatSubscriptionListSchema,
  revenueCatEntitlementListSchema,
  revenueCatTransactionListSchema,
  toRevenueCatSubscriptionSnapshot,
  type RevenueCatCustomerSnapshot,
} from './revenueCatSchemas';

const API_ORIGIN = 'https://api.revenuecat.com';

export class RevenueCatProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs?: number,
    public readonly status?: number,
  ) {
    super(`RevenueCat request failed (${code})`);
    this.name = 'RevenueCatProviderError';
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function validateAppUserId(appUserId: string): void {
  if (!appUserId.startsWith('billing_') || appUserId.length > 100 || appUserId.includes('/')) {
    throw new RevenueCatProviderError('invalid_app_user_id', false);
  }
}

function resolveNextPage(nextPage: string, projectId: string): string {
  const url = new URL(nextPage, API_ORIGIN);
  const expectedPrefix = `/v2/projects/${encodeURIComponent(projectId)}/`;
  if (url.origin !== API_ORIGIN || !url.pathname.startsWith(expectedPrefix)) {
    throw new RevenueCatProviderError('invalid_pagination_url', false);
  }
  return url.toString();
}

function observeContractFailure(error: RevenueCatProviderError, operation: string): void {
  Sentry.captureException(error, {
    tags: { provider: 'revenuecat', operation, terminal: 'true' },
  });
}

async function fetchPage<T>(
  url: string,
  operation: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<T> {
  const startedAt = Date.now();
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${env.REVENUECAT_V2_SECRET_API_KEY}`,
    },
    signal,
  });

  if (!response.ok) {
    const authenticationFailure = response.status === 401 || response.status === 403;
    const retryable = response.status === 408
      || response.status === 423
      || response.status === 429
      || response.status >= 500;
    const error = new RevenueCatProviderError(
      authenticationFailure ? 'provider_authentication_error' : `http_${response.status}`,
      retryable,
      parseRetryAfter(response.headers.get('retry-after')),
      response.status,
    );
    logger.warn({
      provider: 'revenuecat', operation, status: response.status,
      durationMs: Date.now() - startedAt, timeout: false, retryable, errorCode: error.code,
    }, 'Provider operation failed');
    if (authenticationFailure) observeContractFailure(error, operation);
    throw error;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    const error = new RevenueCatProviderError('invalid_response', false, undefined, response.status);
    observeContractFailure(error, operation);
    throw error;
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const error = new RevenueCatProviderError('invalid_response', false, undefined, response.status);
    observeContractFailure(error, operation);
    throw error;
  }
  logger.info({
    provider: 'revenuecat', operation, status: response.status, durationMs: Date.now() - startedAt,
  }, 'Provider operation completed');
  return parsed.data;
}

async function readRevenueCatCustomer(
  appUserId: string,
  storeEnvironment: 'sandbox' | 'production',
): Promise<RevenueCatCustomerSnapshot> {
  validateAppUserId(appUserId);
  if (!env.REVENUECAT_V2_SECRET_API_KEY || !env.REVENUECAT_PROJECT_ID) {
    throw new RevenueCatProviderError('configuration_error', false);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.PROVIDER_TIMEOUT_MS);
  const projectId = env.REVENUECAT_PROJECT_ID;
  try {
    const subscriptionRows: z.output<typeof revenueCatSubscriptionListSchema>['items'] = [];
    let nextUrl: string | null = `${API_ORIGIN}/v2/projects/${encodeURIComponent(projectId)}`
      + `/customers/${encodeURIComponent(appUserId)}/subscriptions?environment=${storeEnvironment}&limit=100`;
    while (nextUrl) {
      const page: z.output<typeof revenueCatSubscriptionListSchema> = await fetchPage(
        nextUrl,
        'list_customer_subscriptions',
        revenueCatSubscriptionListSchema,
        controller.signal,
      );
      subscriptionRows.push(...page.items);
      nextUrl = page.next_page ? resolveNextPage(page.next_page, projectId) : null;
    }

    const subscriptions = [];
    for (const subscription of subscriptionRows) {
      let entitlementNextUrl = subscription.entitlements.next_page
        ? resolveNextPage(subscription.entitlements.next_page, projectId)
        : null;
      while (entitlementNextUrl) {
        const page: z.output<typeof revenueCatEntitlementListSchema> = await fetchPage(
          entitlementNextUrl,
          'list_subscription_entitlements',
          revenueCatEntitlementListSchema,
          controller.signal,
        );
        subscription.entitlements.items.push(...page.items);
        entitlementNextUrl = page.next_page ? resolveNextPage(page.next_page, projectId) : null;
      }
      subscription.entitlements.next_page = null;

      const transactionRows: z.output<typeof revenueCatTransactionListSchema>['items'] = [];
      if (subscription.store === 'play_store') {
        nextUrl = `${API_ORIGIN}/v2/projects/${encodeURIComponent(projectId)}`
          + `/subscriptions/${encodeURIComponent(subscription.id)}/transactions?limit=100&sort=purchased_at&direction=asc`;
        while (nextUrl) {
          const page: z.output<typeof revenueCatTransactionListSchema> = await fetchPage(
            nextUrl,
            'list_subscription_transactions',
            revenueCatTransactionListSchema,
            controller.signal,
          );
          transactionRows.push(...page.items);
          nextUrl = page.next_page ? resolveNextPage(page.next_page, projectId) : null;
        }
      }
      subscriptions.push(toRevenueCatSubscriptionSnapshot(subscription, transactionRows));
    }

    return { customerId: appUserId, storeEnvironment, observedAt: new Date().toISOString(), subscriptions };
  } catch (cause) {
    if (cause instanceof RevenueCatProviderError) throw cause;
    const timeout = controller.signal.aborted;
    const error = new RevenueCatProviderError(timeout ? 'timeout' : 'network_error', true);
    logger.warn({
      provider: 'revenuecat', operation: 'get_customer', status: 'error',
      timeout, retryable: true, errorCode: error.code,
    }, 'Provider operation failed');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function getRevenueCatCustomer(appUserId: string): Promise<RevenueCatCustomerSnapshot> {
  if (!env.BILLING_REVENUECAT_ENABLED) throw new RevenueCatProviderError('disabled', false);
  return readRevenueCatCustomer(appUserId, env.APP_ENV === 'production' ? 'production' : 'sandbox');
}

export async function getRevenueCatSandboxCustomerForDevelopment(
  appUserId: string,
): Promise<RevenueCatCustomerSnapshot> {
  assertDevelopmentScriptContext();
  return readRevenueCatCustomer(appUserId, 'sandbox');
}

export const revenueCatClientInternals = { parseRetryAfter, validateAppUserId, resolveNextPage };
