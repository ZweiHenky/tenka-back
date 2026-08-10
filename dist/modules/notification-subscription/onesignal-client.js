"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.oneSignalClientInternals = exports.OneSignalProviderError = void 0;
exports.sendNotification = sendNotification;
exports.syncTag = syncTag;
exports.removeTag = removeTag;
const env_1 = require("../../config/env");
const logger_1 = require("../../config/logger");
const API_BASE = 'https://api.onesignal.com';
class OneSignalProviderError extends Error {
    constructor(code, retryable, retryAfterMs, status) {
        super(`OneSignal request failed (${code})`);
        this.code = code;
        this.retryable = retryable;
        this.retryAfterMs = retryAfterMs;
        this.status = status;
        this.name = 'OneSignalProviderError';
    }
}
exports.OneSignalProviderError = OneSignalProviderError;
function parseRetryAfter(value) {
    if (!value)
        return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0)
        return seconds * 1000;
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}
async function request(operation, url, init) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env_1.env.PROVIDER_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Key ${env_1.env.ONESIGNAL_REST_API_KEY}`,
                ...init.headers,
            },
            signal: controller.signal,
        });
        if (!response.ok) {
            const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
            logger_1.logger.warn({ provider: 'onesignal', operation, status: response.status, durationMs: Date.now() - startedAt, timeout: false, retryable }, 'Provider operation failed');
            throw new OneSignalProviderError(`http_${response.status}`, retryable, parseRetryAfter(response.headers.get('retry-after')), response.status);
        }
        logger_1.logger.info({ provider: 'onesignal', operation, status: response.status, durationMs: Date.now() - startedAt }, 'Provider operation completed');
    }
    catch (cause) {
        if (cause instanceof OneSignalProviderError)
            throw cause;
        const timeout = controller.signal.aborted;
        const error = new OneSignalProviderError(timeout ? 'timeout' : 'network_error', true);
        logger_1.logger.warn({ provider: 'onesignal', operation, status: 'error', durationMs: Date.now() - startedAt, timeout }, 'Provider operation failed');
        throw error;
    }
    finally {
        clearTimeout(timer);
    }
}
async function sendNotification(payload, idempotencyKey) {
    await request('send_notification', `${API_BASE}/notifications`, {
        method: 'POST',
        body: JSON.stringify({ ...payload, idempotency_key: idempotencyKey }),
    });
}
async function syncTag(oneSignalId, tag, desired) {
    try {
        await request('sync_tag', `${API_BASE}/apps/${env_1.env.ONESIGNAL_APP_ID}/users/by/onesignal_id/${encodeURIComponent(oneSignalId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ tags: { [tag]: desired ? 'true' : null } }),
        });
    }
    catch (error) {
        if (!desired && error instanceof OneSignalProviderError && error.status === 404)
            return;
        throw error;
    }
}
async function removeTag(oneSignalId, tag) {
    try {
        await syncTag(oneSignalId, tag, false);
        return true;
    }
    catch {
        return false;
    }
}
exports.oneSignalClientInternals = { parseRetryAfter };
//# sourceMappingURL=onesignal-client.js.map