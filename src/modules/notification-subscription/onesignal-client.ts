import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { Sentry } from '../../instrument';

const API_BASE = 'https://api.onesignal.com';

export async function removeTag(oneSignalId: string, tag: string): Promise<boolean> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/apps/${env.ONESIGNAL_APP_ID}/users/by/onesignal_id/${oneSignalId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${env.ONESIGNAL_REST_API_KEY}`,
      },
      body: JSON.stringify({ tags: { [tag]: null } }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const error = new Error(`OneSignal removeTag failed with status ${res.status}`);
      logger.warn({ provider: 'onesignal', operation: 'remove_tag', status: res.status, durationMs: Date.now() - startedAt, timeout: false }, 'Provider operation failed');
      Sentry.captureException(error, { tags: { provider: 'onesignal', operation: 'remove_tag' }, extra: { status: res.status } });
      return false;
    }
    logger.info({ provider: 'onesignal', operation: 'remove_tag', status: res.status, durationMs: Date.now() - startedAt, timeout: false }, 'Provider operation completed');
    return true;
  } catch (e) {
    const timeout = controller.signal.aborted;
    const error = e instanceof Error ? e : new Error('OneSignal removeTag failed');
    logger.warn({ provider: 'onesignal', operation: 'remove_tag', status: 'error', durationMs: Date.now() - startedAt, timeout, errorName: error.name }, 'Provider operation failed');
    Sentry.captureException(error, { tags: { provider: 'onesignal', operation: 'remove_tag', timeout: String(timeout) } });
    return false;
  } finally {
    clearTimeout(timer);
  }
}
