import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enabled: true,
  apiKey: 'sk_revenuecat-v2-test',
  projectId: 'proj_test',
  appEnv: 'local',
  dbTarget: 'development',
  timeoutMs: 5000,
  logger: { info: vi.fn(), warn: vi.fn() },
  captureException: vi.fn(),
}));

vi.mock('../../config/env', () => ({
  env: {
    get BILLING_REVENUECAT_ENABLED() { return mocks.enabled; },
    get REVENUECAT_V2_SECRET_API_KEY() { return mocks.apiKey; },
    get REVENUECAT_PROJECT_ID() { return mocks.projectId; },
    get APP_ENV() { return mocks.appEnv; },
    get DB_TARGET() { return mocks.dbTarget; },
    get PROVIDER_TIMEOUT_MS() { return mocks.timeoutMs; },
  },
}));
vi.mock('../../config/logger', () => ({ logger: mocks.logger }));
vi.mock('../../instrument', () => ({ Sentry: { captureException: mocks.captureException } }));

import {
  getRevenueCatCustomer,
  getRevenueCatSandboxCustomerForDevelopment,
  RevenueCatProviderError,
  revenueCatClientInternals,
} from './revenueCatClient';

const PURCHASED_AT = Date.parse('2026-09-01T12:00:00Z');
const EXPIRES_AT = Date.parse('2026-10-01T12:00:00Z');
const originalDevelopmentScriptAuth = process.env.DEVELOPMENT_SCRIPT_AUTH;

function subscription(id = 'sub_google_1') {
  return {
    object: 'subscription',
    id,
    customer_id: 'billing_account-1',
    original_customer_id: 'billing_account-1',
    product_id: 'prod_google_1',
    starts_at: PURCHASED_AT,
    current_period_starts_at: PURCHASED_AT,
    current_period_ends_at: EXPIRES_AT,
    ends_at: EXPIRES_AT,
    gives_access: true,
    pending_payment: false,
    auto_renewal_status: 'will_renew',
    status: 'active',
    expiration_reason: null,
    total_revenue_in_usd: { currency: 'USD', gross: 9.99, tax: 0, proceeds: 7 },
    entitlements: {
      object: 'list',
      items: [{ state: 'active', object: 'entitlement', lookup_key: 'league_management', private: 'discard' }],
      next_page: null,
      url: '/ignored',
    },
    environment: 'sandbox',
    store: 'play_store',
    store_subscription_identifier: 'GPA.latest',
    ownership: 'purchased',
    pending_changes: null,
    private_customer_email: 'private@example.com',
  };
}

function transaction(id = 'GPA.latest') {
  return {
    object: 'subscription_transaction',
    id,
    purchased_at: PURCHASED_AT,
    product_store_identifier: 'tenka_capacity_2:monthly',
    expiration_date: EXPIRES_AT,
    effective_expiration_date: EXPIRES_AT,
    revenue_in_local_currency: { currency: 'MXN', gross: 100 },
  };
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe('RevenueCat v2 client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.apiKey = 'sk_revenuecat-v2-test';
    mocks.projectId = 'proj_test';
    mocks.appEnv = 'local';
    mocks.dbTarget = 'development';
    mocks.timeoutMs = 5000;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (originalDevelopmentScriptAuth === undefined) delete process.env.DEVELOPMENT_SCRIPT_AUTH;
    else process.env.DEVELOPMENT_SCRIPT_AUTH = originalDevelopmentScriptAuth;
  });

  it('loads sandbox subscriptions and transactions and strips financial and personal data', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url.includes('/transactions')) {
        return Promise.resolve(jsonResponse({ object: 'list', items: [transaction()], next_page: null, url: '/ignored' }));
      }
      return Promise.resolve(jsonResponse({ object: 'list', items: [subscription()], next_page: null, url: '/ignored' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getRevenueCatCustomer('billing_account-1');

    expect(fetchMock.mock.calls[0][0]).toContain('environment=sandbox');
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer sk_revenuecat-v2-test',
    });
    expect(result).toMatchObject({
      customerId: 'billing_account-1',
      storeEnvironment: 'sandbox',
      subscriptions: [{
        id: 'sub_google_1',
        expirationReason: null,
        entitlements: [{ lookupKey: 'league_management', state: 'active' }],
        transactions: [{ id: 'GPA.latest', productStoreIdentifier: 'tenka_capacity_2:monthly' }],
      }],
    });
    expect(JSON.stringify(result)).not.toContain('private@example.com');
    expect(JSON.stringify(result)).not.toContain('gross');
  });

  it('paginates subscriptions and transactions using only trusted RevenueCat URLs', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      calls.push(url);
      if (url.includes('/transactions')) {
        const second = url.includes('starting_after=GPA.first');
        return Promise.resolve(jsonResponse({
          items: [transaction(second ? 'GPA.second' : 'GPA.first')],
          next_page: second ? null : '/v2/projects/proj_test/subscriptions/sub_google_1/transactions?starting_after=GPA.first',
        }));
      }
      const second = url.includes('starting_after=sub_google_0');
      return Promise.resolve(jsonResponse({
        items: second ? [subscription()] : [],
        next_page: second ? null : '/v2/projects/proj_test/customers/billing_account-1/subscriptions?starting_after=sub_google_0',
      }));
    }));

    const result = await getRevenueCatCustomer('billing_account-1');
    expect(result.subscriptions[0].transactions.map(({ id }) => id)).toEqual(['GPA.first', 'GPA.second']);
    expect(calls).toHaveLength(4);
  });

  it('completes paginated entitlement evidence before returning the snapshot', async () => {
    const firstSubscription = subscription();
    const first = {
      ...firstSubscription,
      entitlements: {
        ...firstSubscription.entitlements,
        items: [],
        next_page: '/v2/projects/proj_test/subscriptions/sub_google_1/entitlements?starting_after=ent_0',
      },
    };
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/entitlements')) {
        return Promise.resolve(jsonResponse({
          items: [{ state: 'active', lookup_key: 'league_management' }], next_page: null,
        }));
      }
      if (url.includes('/transactions')) {
        return Promise.resolve(jsonResponse({ items: [transaction()], next_page: null }));
      }
      return Promise.resolve(jsonResponse({ items: [first], next_page: null }));
    }));

    const result = await getRevenueCatCustomer('billing_account-1');
    expect(result.subscriptions[0]).toMatchObject({
      entitlements: [{ lookupKey: 'league_management', state: 'active' }],
      entitlementPageIncomplete: false,
    });
  });

  it('preserves inactive entitlement association and expiration reason', async () => {
    const expired = {
      ...subscription(),
      gives_access: false,
      auto_renewal_status: 'will_not_renew',
      status: 'expired',
      expiration_reason: 'BILLING_ERROR',
      entitlements: {
        ...subscription().entitlements,
        items: [{ state: 'inactive', lookup_key: 'league_management' }],
      },
    };
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(jsonResponse(
      url.includes('/transactions')
        ? { items: [transaction()], next_page: null }
        : { items: [expired], next_page: null },
    ))));

    const result = await getRevenueCatCustomer('billing_account-1');
    expect(result.subscriptions[0]).toMatchObject({
      expirationReason: 'BILLING_ERROR',
      entitlements: [{ lookupKey: 'league_management', state: 'inactive' }],
    });
  });

  it('rejects an untrusted pagination URL', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({
      items: [], next_page: 'https://attacker.example/private',
    }))));
    await expect(getRevenueCatCustomer('billing_account-1')).rejects.toMatchObject({
      code: 'invalid_pagination_url', retryable: false,
    });
  });

  it('uses the production filter only in production', async () => {
    mocks.appEnv = 'production';
    const fetchMock = vi.fn((url: string) => Promise.resolve(jsonResponse({ items: [], next_page: null })));
    vi.stubGlobal('fetch', fetchMock);
    await getRevenueCatCustomer('billing_account-1');
    expect(fetchMock.mock.calls[0][0]).toContain('environment=production');
  });

  it('keeps non-Google subscriptions as evidence without requesting transactions', async () => {
    const apple = { ...subscription('sub_apple_1'), store: 'app_store' };
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ items: [apple], next_page: null })));
    vi.stubGlobal('fetch', fetchMock);
    const result = await getRevenueCatCustomer('billing_account-1');
    expect(result.subscriptions[0].transactions).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('fails closed when disabled or incompletely configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mocks.enabled = false;
    await expect(getRevenueCatCustomer('billing_account-1')).rejects.toMatchObject({ code: 'disabled' });
    mocks.enabled = true;
    mocks.projectId = '';
    await expect(getRevenueCatCustomer('billing_account-1')).rejects.toMatchObject({ code: 'configuration_error' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows only the protected development reader to query sandbox while globally disabled', async () => {
    mocks.enabled = false;
    process.env.DEVELOPMENT_SCRIPT_AUTH = 'tenka-development-script-v1';
    const fetchMock = vi.fn((_url: string) => Promise.resolve(jsonResponse({ items: [], next_page: null })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getRevenueCatSandboxCustomerForDevelopment('billing_account-1')).resolves.toMatchObject({
      customerId: 'billing_account-1', storeEnvironment: 'sandbox', subscriptions: [],
    });
    expect(fetchMock.mock.calls[0][0]).toContain('environment=sandbox');
  });

  it('blocks the development reader outside its protected local context', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    delete process.env.DEVELOPMENT_SCRIPT_AUTH;
    await expect(getRevenueCatSandboxCustomerForDevelopment('billing_account-1'))
      .rejects.toThrow('Direct database script execution is disabled');

    process.env.DEVELOPMENT_SCRIPT_AUTH = 'tenka-development-script-v1';
    mocks.appEnv = 'production';
    mocks.dbTarget = 'production';
    await expect(getRevenueCatSandboxCustomerForDevelopment('billing_account-1'))
      .rejects.toThrow('Database scripts are only allowed for the development target');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['anonymous-id', `billing_${'x'.repeat(100)}`, 'billing_account/alias'])(
    'rejects invalid canonical identity %s', async (appUserId) => {
      vi.stubGlobal('fetch', vi.fn());
      await expect(getRevenueCatCustomer(appUserId)).rejects.toMatchObject({ code: 'invalid_app_user_id' });
    },
  );

  it('aborts requests that exceed the provider timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const result = getRevenueCatCustomer('billing_account-1');
    const rejection = expect(result).rejects.toMatchObject({ code: 'timeout', retryable: true });
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
  });

  it.each([[400, false], [408, true], [423, true], [429, true], [500, true]])(
    'classifies HTTP %s with retryable=%s', async (status, retryable) => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        ok: false, status, headers: new Headers(), json: vi.fn(),
      })));
      await expect(getRevenueCatCustomer('billing_account-1')).rejects.toMatchObject({
        code: `http_${status}`, retryable, status,
      });
    },
  );

  it.each([401, 403])('observes authentication failure %s without leaking credentials', async (status) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false, status, headers: new Headers(), json: vi.fn(),
    })));
    await expect(getRevenueCatCustomer('billing_private')).rejects.toMatchObject({
      code: 'provider_authentication_error', retryable: false,
    });
    expect(mocks.captureException).toHaveBeenCalledOnce();
    expect(JSON.stringify({ logs: mocks.logger.warn.mock.calls, sentry: mocks.captureException.mock.calls }))
      .not.toContain('sk_revenuecat-v2-test');
  });

  it('rejects malformed successful responses as terminal contract failures', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ items: 'private@example.com' }))));
    await expect(getRevenueCatCustomer('billing_account-1')).rejects.toBeInstanceOf(RevenueCatProviderError);
    expect(mocks.captureException).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.captureException.mock.calls)).not.toContain('private@example.com');
  });

  it('parses Retry-After and validates pagination paths', () => {
    expect(revenueCatClientInternals.parseRetryAfter('3')).toBe(3000);
    expect(revenueCatClientInternals.resolveNextPage('/v2/projects/proj_test/next', 'proj_test'))
      .toBe('https://api.revenuecat.com/v2/projects/proj_test/next');
    expect(() => revenueCatClientInternals.resolveNextPage('/v2/projects/other/next', 'proj_test'))
      .toThrow('invalid_pagination_url');
  });
});
