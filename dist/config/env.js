"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
exports.parseBackendEnv = parseBackendEnv;
exports.getCorsAllowedOrigins = getCorsAllowedOrigins;
require("dotenv/config");
const zod_1 = require("zod");
const requiredString = zod_1.z.string().trim().min(1, 'is required');
const optionalString = (schema) => zod_1.z.preprocess((value) => typeof value === 'string' && value.trim() === '' ? undefined : value, schema.optional());
const bodyLimit = zod_1.z.string().trim().regex(/^\d+(kb|mb)$/i, 'must use a value such as 100kb or 1mb');
function isPrivateHostname(hostname) {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host === '::1')
        return true;
    const parts = host.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
        return /^(fc|fd|fe8|fe9|fea|feb)/.test(host);
    }
    return parts[0] === 10
        || parts[0] === 127
        || (parts[0] === 169 && parts[1] === 254)
        || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
        || (parts[0] === 192 && parts[1] === 168);
}
const backendEnvSchema = zod_1.z.object({
    APP_ENV: zod_1.z.enum(['local', 'preview', 'production']),
    NODE_ENV: zod_1.z.enum(['development', 'test', 'production']),
    PORT: zod_1.z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: zod_1.z.url().refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol), {
        message: 'must be a PostgreSQL URL',
    }),
    BETTER_AUTH_SECRET: zod_1.z.string().min(32, 'must contain at least 32 characters'),
    BETTER_AUTH_URL: zod_1.z.url(),
    GOOGLE_CLIENT_ID: requiredString,
    GOOGLE_CLIENT_SECRET: requiredString,
    ONESIGNAL_APP_ID: requiredString,
    ONESIGNAL_REST_API_KEY: requiredString,
    CLOUDINARY_CLOUD_NAME: requiredString,
    CLOUDINARY_API_KEY: requiredString,
    CLOUDINARY_API_SECRET: requiredString,
    CLOUDINARY_DELIVERY_HOST: zod_1.z.string().trim().min(1).default('res.cloudinary.com'),
    PHONE_OTP_MODE: zod_1.z.enum(['console', 'disabled']),
    LOG_LEVEL: zod_1.z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    SENTRY_DSN: optionalString(zod_1.z.url()),
    SENTRY_RELEASE: optionalString(zod_1.z.string().trim().min(1)),
    RAILWAY_GIT_COMMIT_SHA: optionalString(zod_1.z.string().trim().min(1)),
    READINESS_TIMEOUT_MS: zod_1.z.coerce.number().int().min(500).max(30000).default(5000),
    PROVIDER_TIMEOUT_MS: zod_1.z.coerce.number().int().min(500).max(30000).default(5000),
    SHUTDOWN_GRACE_MS: zod_1.z.coerce.number().int().min(1000).max(30000).default(10000),
    CORS_ALLOWED_ORIGINS: zod_1.z.string().trim().default('http://localhost:8081,http://localhost:19006,http://localhost:3000'),
    JSON_BODY_LIMIT: bodyLimit.default('100kb'),
    URLENCODED_BODY_LIMIT: bodyLimit.default('100kb'),
    GLOBAL_RATE_LIMIT: zod_1.z.coerce.number().int().min(1).max(10000).default(300),
    AUTH_RATE_LIMIT: zod_1.z.coerce.number().int().min(1).max(1000).default(100),
    OTP_SEND_RATE_LIMIT: zod_1.z.coerce.number().int().min(1).max(100).default(5),
    OTP_VERIFY_RATE_LIMIT: zod_1.z.coerce.number().int().min(1).max(100).default(10),
    SUBSCRIPTION_RATE_LIMIT: zod_1.z.coerce.number().int().min(1).max(1000).default(30),
    UPLOAD_RATE_LIMIT: zod_1.z.coerce.number().int().min(1).max(1000).default(30),
    HTTP_REQUEST_TIMEOUT_MS: zod_1.z.coerce.number().int().min(1000).max(120000).default(30000),
    HTTP_HEADERS_TIMEOUT_MS: zod_1.z.coerce.number().int().min(1000).max(120000).default(35000),
    HTTP_KEEP_ALIVE_TIMEOUT_MS: zod_1.z.coerce.number().int().min(1000).max(60000).default(5000),
}).superRefine((values, context) => {
    if (values.APP_ENV !== 'local' && values.PHONE_OTP_MODE !== 'disabled') {
        context.addIssue({ code: 'custom', path: ['PHONE_OTP_MODE'], message: 'must be disabled outside the local app environment' });
    }
    if (values.APP_ENV !== 'local' && !values.SENTRY_DSN) {
        context.addIssue({ code: 'custom', path: ['SENTRY_DSN'], message: 'is required outside the local app environment' });
    }
    if (values.APP_ENV === 'production') {
        const url = new URL(values.BETTER_AUTH_URL);
        const isNgrok = /(^|\.)ngrok(-free)?\.(app|io)$/.test(url.hostname.toLowerCase());
        if (url.protocol !== 'https:' || isPrivateHostname(url.hostname) || isNgrok) {
            context.addIssue({ code: 'custom', path: ['BETTER_AUTH_URL'], message: 'must be a stable public HTTPS URL in production' });
        }
    }
    const origins = values.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
    if (values.APP_ENV !== 'local' && origins.length === 0) {
        context.addIssue({ code: 'custom', path: ['CORS_ALLOWED_ORIGINS'], message: 'must contain at least one origin outside local' });
    }
    for (const origin of origins) {
        if (origin === '*') {
            context.addIssue({ code: 'custom', path: ['CORS_ALLOWED_ORIGINS'], message: 'must not contain a wildcard' });
            continue;
        }
        try {
            const url = new URL(origin);
            if (url.origin !== origin || (values.APP_ENV === 'production' && url.protocol !== 'https:')) {
                throw new Error();
            }
        }
        catch {
            context.addIssue({ code: 'custom', path: ['CORS_ALLOWED_ORIGINS'], message: 'must contain valid origins; production origins must use HTTPS' });
        }
    }
    if (values.HTTP_HEADERS_TIMEOUT_MS <= values.HTTP_KEEP_ALIVE_TIMEOUT_MS) {
        context.addIssue({ code: 'custom', path: ['HTTP_HEADERS_TIMEOUT_MS'], message: 'must be greater than HTTP_KEEP_ALIVE_TIMEOUT_MS' });
    }
});
function parseBackendEnv(input) {
    const result = backendEnvSchema.safeParse(input);
    if (result.success)
        return result.data;
    const details = result.error.issues.map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`).join('; ');
    throw new Error(`Invalid backend environment: ${details}`);
}
exports.env = parseBackendEnv(process.env);
function getCorsAllowedOrigins(configuration = exports.env) {
    return configuration.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
}
//# sourceMappingURL=env.js.map