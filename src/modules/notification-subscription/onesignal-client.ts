import { env } from '../../config/env';
import { logger } from '../../config/logger';

const API_BASE = 'https://api.onesignal.com';

export class OneSignalProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs?: number,
    public readonly status?: number,
  ) {
    super(`OneSignal request failed (${code})`);
    this.name = 'OneSignalProviderError';
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

async function request(operation: string, url: string, init: RequestInit): Promise<void> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${env.ONESIGNAL_REST_API_KEY}`,
        ...init.headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      logger.warn({ provider: 'onesignal', operation, status: response.status, durationMs: Date.now() - startedAt, timeout: false, retryable }, 'Provider operation failed');
      throw new OneSignalProviderError(
        `http_${response.status}`,
        retryable,
        parseRetryAfter(response.headers.get('retry-after')),
        response.status,
      );
    }
    logger.info({ provider: 'onesignal', operation, status: response.status, durationMs: Date.now() - startedAt }, 'Provider operation completed');
  } catch (cause) {
    if (cause instanceof OneSignalProviderError) throw cause;
    const timeout = controller.signal.aborted;
    const error = new OneSignalProviderError(timeout ? 'timeout' : 'network_error', true);
    logger.warn({ provider: 'onesignal', operation, status: 'error', durationMs: Date.now() - startedAt, timeout }, 'Provider operation failed');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendNotification(payload: Record<string, unknown>, idempotencyKey: string): Promise<void> {
  await request('send_notification', `${API_BASE}/notifications`, {
    method: 'POST',
    body: JSON.stringify({ ...payload, idempotency_key: idempotencyKey }),
  });
}

export async function syncTag(oneSignalId: string, tag: string, desired: boolean): Promise<void> {
  try {
    await request('sync_tag', `${API_BASE}/apps/${env.ONESIGNAL_APP_ID}/users/by/onesignal_id/${encodeURIComponent(oneSignalId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ tags: { [tag]: desired ? 'true' : null } }),
    });
  } catch (error) {
    if (!desired && error instanceof OneSignalProviderError && error.status === 404) return;
    throw error;
  }
}

export async function removeTag(oneSignalId: string, tag: string): Promise<boolean> {
  try {
    await syncTag(oneSignalId, tag, false);
    return true;
  } catch {
    return false;
  }
}

export const oneSignalClientInternals = { parseRetryAfter };
