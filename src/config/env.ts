import 'dotenv/config';
import { z } from 'zod';

const requiredString = z.string().trim().min(1, 'is required');
const optionalString = (schema: z.ZodType<string>) => z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  schema.optional(),
);
const bodyLimit = z.string().trim().regex(/^\d+(kb|mb)$/i, 'must use a value such as 100kb or 1mb');
const booleanFlag = z.enum(['true', 'false']).default('false').transform((value) => value === 'true');
const revenueCatSecretApiKey = z.string().trim().regex(/^sk_[A-Za-z0-9_-]+$/, 'must be a RevenueCat secret API key beginning with sk_');
const webhookSecret = z.string().trim().min(32, 'must contain at least 32 characters');
const postgresUrl = z.url().refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol), {
  message: 'must be a PostgreSQL URL',
});
const redisUrl = z.url().refine((value) => ['redis:', 'rediss:'].includes(new URL(value).protocol), {
  message: 'must be a Redis URL',
});

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;

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

const backendEnvSchema = z.object({
  APP_ENV: z.enum(['local', 'preview', 'production']),
  DB_TARGET: z.enum(['development', 'preview', 'production']),
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: optionalString(postgresUrl),
  DEV_DATABASE_URL: optionalString(postgresUrl),
  DIRECT_DATABASE_URL: optionalString(postgresUrl),
  DEV_DIRECT_DATABASE_URL: optionalString(postgresUrl),
  TEST_DATABASE_URL: optionalString(postgresUrl),
  SHADOW_DATABASE_URL: optionalString(postgresUrl),
  REDIS_URL: redisUrl,
  BETTER_AUTH_SECRET: z.string().min(32, 'must contain at least 32 characters'),
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: requiredString,
  GOOGLE_CLIENT_SECRET: requiredString,
  GOOGLE_MAPS_API_KEY: optionalString(z.string().trim().min(1)),
  APPLE_CLIENT_ID: optionalString(z.string().trim().min(1)),
  APPLE_TEAM_ID: optionalString(z.string().trim().min(1)),
  APPLE_KEY_ID: optionalString(z.string().trim().min(1)),
  APPLE_PRIVATE_KEY: optionalString(z.string().trim().min(1)),
  APPLE_APP_BUNDLE_IDENTIFIER: optionalString(z.string().trim().min(1)),
  ONESIGNAL_APP_ID: requiredString,
  ONESIGNAL_REST_API_KEY: requiredString,
  CLOUDINARY_CLOUD_NAME: requiredString,
  CLOUDINARY_API_KEY: requiredString,
  CLOUDINARY_API_SECRET: requiredString,
  CLOUDINARY_DELIVERY_HOST: z.string().trim().min(1).default('res.cloudinary.com'),
  PHONE_OTP_MODE: z.enum(['console', 'twilio', 'disabled']),
  TWILIO_ACCOUNT_SID: optionalString(z.string().trim().min(1)),
  TWILIO_AUTH_TOKEN: optionalString(z.string().trim().min(1)),
  TWILIO_PHONE_NUMBER: optionalString(z.string().regex(/^\+[1-9]\d{7,14}$/, 'must be an E.164 phone number')),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SENTRY_DSN: optionalString(z.url()),
  SENTRY_RELEASE: optionalString(z.string().trim().min(1)),
  RAILWAY_GIT_COMMIT_SHA: optionalString(z.string().trim().min(1)),
  READINESS_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(5000),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(5000),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1000).max(30000).default(10000),
  BILLING_REVENUECAT_ENABLED: booleanFlag,
  BILLING_PERIODIC_RECONCILIATION_ENABLED: booleanFlag,
  BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED: booleanFlag,
  BILLING_PAID_ACCESS_SHADOW_ENABLED: booleanFlag,
  BILLING_RESOURCE_ACCESS_SHADOW_ENABLED: booleanFlag,
  BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED: booleanFlag,
  BILLING_PURCHASES_ENABLED: booleanFlag,
  BILLING_RECONCILIATION_ACTIVE_INTERVAL_MINUTES: z.coerce.number().int().min(60).max(10080).default(1440),
  BILLING_RECONCILIATION_CRITICAL_INTERVAL_MINUTES: z.coerce.number().int().min(30).max(1440).default(360),
  BILLING_RECONCILIATION_BATCH_SIZE: z.coerce.number().int().min(1).max(20).default(5),
  REVENUECAT_V2_SECRET_API_KEY: optionalString(revenueCatSecretApiKey),
  REVENUECAT_PROJECT_ID: optionalString(z.string().trim().min(1).max(255)),
  REVENUECAT_WEBHOOK_SECRET: optionalString(webhookSecret),
  REVENUECAT_WEBHOOK_PREVIOUS_SECRET: optionalString(webhookSecret),
  REVENUECAT_WEBHOOK_SIGNING_SECRET: optionalString(webhookSecret),
  REVENUECAT_WEBHOOK_SIGNATURE_MODE: z.enum(['disabled', 'observe', 'enforce']).default('disabled'),
  REVENUECAT_WEBHOOK_SIGNATURE_OBSERVE_UNTIL: optionalString(z.iso.datetime({ offset: true })),
  REVENUECAT_WEBHOOK_BODY_LIMIT: bodyLimit.default('256kb'),
  REVENUECAT_WEBHOOK_RATE_LIMIT: z.coerce.number().int().min(1).max(10000).default(300),
  BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  BILLING_SYNC_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(10),
  BILLING_SYNC_RATE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(10),
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(30).default(7),
  CORS_ALLOWED_ORIGINS: z.string().trim().default('http://localhost:8081,http://localhost:19006,http://localhost:3000'),
  JSON_BODY_LIMIT: bodyLimit.default('100kb'),
  URLENCODED_BODY_LIMIT: bodyLimit.default('100kb'),
  GLOBAL_RATE_LIMIT: z.coerce.number().int().min(1).max(10000).default(400),
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(100),
  OTP_SEND_RATE_LIMIT: z.coerce.number().int().min(1).max(100).default(5),
  OTP_VERIFY_RATE_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  SUBSCRIPTION_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(30),
  UPLOAD_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(30),
  PLAYER_PHONE_LOOKUP_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(30),
  REFEREE_READ_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(40),
  WAITLIST_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(5),
  WAITLIST_RATE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
  JORNADA_GENERATION_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(30),
  JORNADA_GENERATION_RATE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(10),
  PLAYOFF_GENERATION_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(15),
  PLAYOFF_GENERATION_RATE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  DESTRUCTIVE_OPERATION_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(20),
  DESTRUCTIVE_OPERATION_RATE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
  HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  HTTP_HEADERS_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(35000),
  HTTP_KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
}).superRefine((values, context) => {
  if (values.APP_ENV === 'local') {
    if (values.DB_TARGET !== 'development') {
      context.addIssue({ code: 'custom', path: ['DB_TARGET'], message: 'must be development when APP_ENV is local' });
    }
    if (!values.DEV_DATABASE_URL) {
      context.addIssue({ code: 'custom', path: ['DEV_DATABASE_URL'], message: 'is required when APP_ENV is local; DATABASE_URL is never used as fallback' });
    }
  } else {
    if (values.DB_TARGET !== values.APP_ENV) {
      context.addIssue({ code: 'custom', path: ['DB_TARGET'], message: `must be ${values.APP_ENV} when APP_ENV is ${values.APP_ENV}` });
    }
    if (!values.DATABASE_URL) {
      context.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: `is required when APP_ENV is ${values.APP_ENV}` });
    }
  }

  if (values.APP_ENV !== 'local' && !['twilio', 'disabled'].includes(values.PHONE_OTP_MODE)) {
    context.addIssue({ code: 'custom', path: ['PHONE_OTP_MODE'], message: 'must be disabled or twilio outside the local app environment' });
  }

  if (values.PHONE_OTP_MODE === 'twilio') {
    if (!values.TWILIO_ACCOUNT_SID) {
      context.addIssue({ code: 'custom', path: ['TWILIO_ACCOUNT_SID'], message: 'is required when PHONE_OTP_MODE is twilio' });
    }
    if (!values.TWILIO_AUTH_TOKEN) {
      context.addIssue({ code: 'custom', path: ['TWILIO_AUTH_TOKEN'], message: 'is required when PHONE_OTP_MODE is twilio' });
    }
    if (!values.TWILIO_PHONE_NUMBER) {
      context.addIssue({ code: 'custom', path: ['TWILIO_PHONE_NUMBER'], message: 'is required when PHONE_OTP_MODE is twilio' });
    }
  }

  if (values.APP_ENV !== 'local' && !values.SENTRY_DSN) {
    context.addIssue({ code: 'custom', path: ['SENTRY_DSN'], message: 'is required outside the local app environment' });
  }

  if (values.BILLING_REVENUECAT_ENABLED) {
    if (!values.REVENUECAT_V2_SECRET_API_KEY) {
      context.addIssue({ code: 'custom', path: ['REVENUECAT_V2_SECRET_API_KEY'], message: 'is required when BILLING_REVENUECAT_ENABLED is true' });
    }
    if (!values.REVENUECAT_PROJECT_ID) {
      context.addIssue({ code: 'custom', path: ['REVENUECAT_PROJECT_ID'], message: 'is required when BILLING_REVENUECAT_ENABLED is true' });
    }
    if (!values.REVENUECAT_WEBHOOK_SECRET) {
      context.addIssue({ code: 'custom', path: ['REVENUECAT_WEBHOOK_SECRET'], message: 'is required when BILLING_REVENUECAT_ENABLED is true' });
    }
  }
  if (values.BILLING_PERIODIC_RECONCILIATION_ENABLED && !values.BILLING_REVENUECAT_ENABLED) {
    context.addIssue({
      code: 'custom',
      path: ['BILLING_PERIODIC_RECONCILIATION_ENABLED'],
      message: 'requires BILLING_REVENUECAT_ENABLED=true',
    });
  }
  if (values.BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED && !values.BILLING_REVENUECAT_ENABLED) {
    context.addIssue({
      code: 'custom',
      path: ['BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED'],
      message: 'requires BILLING_REVENUECAT_ENABLED=true',
    });
  }
  if (values.BILLING_PAID_ACCESS_SHADOW_ENABLED && !values.BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED) {
    context.addIssue({
      code: 'custom',
      path: ['BILLING_PAID_ACCESS_SHADOW_ENABLED'],
      message: 'requires BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED=true',
    });
  }
  if (values.BILLING_RESOURCE_ACCESS_SHADOW_ENABLED && !values.BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED) {
    context.addIssue({
      code: 'custom',
      path: ['BILLING_RESOURCE_ACCESS_SHADOW_ENABLED'],
      message: 'requires BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED=true',
    });
  }
  if (values.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED
    && (!values.BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED
      || !values.BILLING_RESOURCE_ACCESS_SHADOW_ENABLED)) {
    context.addIssue({
      code: 'custom',
      path: ['BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED'],
      message: 'requires BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED=true and BILLING_RESOURCE_ACCESS_SHADOW_ENABLED=true',
    });
  }
  if (values.BILLING_PURCHASES_ENABLED && !values.BILLING_REVENUECAT_ENABLED) {
    context.addIssue({
      code: 'custom',
      path: ['BILLING_PURCHASES_ENABLED'],
      message: 'requires BILLING_REVENUECAT_ENABLED=true',
    });
  }
  if (values.BILLING_PURCHASES_ENABLED && !values.BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED) {
    context.addIssue({
      code: 'custom',
      path: ['BILLING_PURCHASES_ENABLED'],
      message: 'requires BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED=true',
    });
  }

  if (values.REVENUECAT_WEBHOOK_SECRET
    && values.REVENUECAT_WEBHOOK_SECRET === values.REVENUECAT_WEBHOOK_PREVIOUS_SECRET) {
    context.addIssue({
      code: 'custom',
      path: ['REVENUECAT_WEBHOOK_PREVIOUS_SECRET'],
      message: 'must differ from REVENUECAT_WEBHOOK_SECRET',
    });
  }
  if (values.REVENUECAT_WEBHOOK_SIGNING_SECRET
    && [values.REVENUECAT_WEBHOOK_SECRET, values.REVENUECAT_WEBHOOK_PREVIOUS_SECRET]
      .includes(values.REVENUECAT_WEBHOOK_SIGNING_SECRET)) {
    context.addIssue({
      code: 'custom',
      path: ['REVENUECAT_WEBHOOK_SIGNING_SECRET'],
      message: 'must differ from webhook authorization secrets',
    });
  }
  if (values.REVENUECAT_WEBHOOK_SIGNATURE_MODE !== 'disabled'
    && !values.REVENUECAT_WEBHOOK_SIGNING_SECRET) {
    context.addIssue({
      code: 'custom',
      path: ['REVENUECAT_WEBHOOK_SIGNING_SECRET'],
      message: `is required when REVENUECAT_WEBHOOK_SIGNATURE_MODE is ${values.REVENUECAT_WEBHOOK_SIGNATURE_MODE}`,
    });
  }
  if (values.REVENUECAT_WEBHOOK_SIGNATURE_MODE === 'observe') {
    if (!values.REVENUECAT_WEBHOOK_SIGNATURE_OBSERVE_UNTIL) {
      context.addIssue({
        code: 'custom',
        path: ['REVENUECAT_WEBHOOK_SIGNATURE_OBSERVE_UNTIL'],
        message: 'is required when REVENUECAT_WEBHOOK_SIGNATURE_MODE is observe',
      });
    } else {
      const observeUntil = Date.parse(values.REVENUECAT_WEBHOOK_SIGNATURE_OBSERVE_UNTIL);
      const remainingMs = observeUntil - Date.now();
      if (remainingMs > 24 * 60 * 60_000) {
        context.addIssue({
          code: 'custom',
          path: ['REVENUECAT_WEBHOOK_SIGNATURE_OBSERVE_UNTIL'],
          message: 'must be no more than 24 hours in the future',
        });
      }
    }
  } else if (values.REVENUECAT_WEBHOOK_SIGNATURE_OBSERVE_UNTIL) {
    context.addIssue({
      code: 'custom',
      path: ['REVENUECAT_WEBHOOK_SIGNATURE_OBSERVE_UNTIL'],
      message: 'is only allowed when REVENUECAT_WEBHOOK_SIGNATURE_MODE is observe',
    });
  }
  if (values.APP_ENV === 'production' && values.BILLING_REVENUECAT_ENABLED
    && values.REVENUECAT_WEBHOOK_SIGNATURE_MODE === 'disabled') {
    context.addIssue({
      code: 'custom',
      path: ['REVENUECAT_WEBHOOK_SIGNATURE_MODE'],
      message: 'must be observe or enforce when RevenueCat billing is enabled in production',
    });
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
    } catch {
      context.addIssue({ code: 'custom', path: ['CORS_ALLOWED_ORIGINS'], message: 'must contain valid origins; production origins must use HTTPS' });
    }
  }
  if (values.HTTP_HEADERS_TIMEOUT_MS <= values.HTTP_KEEP_ALIVE_TIMEOUT_MS) {
    context.addIssue({ code: 'custom', path: ['HTTP_HEADERS_TIMEOUT_MS'], message: 'must be greater than HTTP_KEEP_ALIVE_TIMEOUT_MS' });
  }
}).transform((values) => ({
  ...values,
  DATABASE_URL: values.APP_ENV === 'local' ? values.DEV_DATABASE_URL! : values.DATABASE_URL!,
}));

export type BackendEnv = z.infer<typeof backendEnvSchema>;

export function parseBackendEnv(input: Record<string, unknown>): BackendEnv {
  const result = backendEnvSchema.safeParse(input);
  if (result.success) return result.data;
  const details = result.error.issues.map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`).join('; ');
  throw new Error(`Invalid backend environment: ${details}`);
}

export const env = parseBackendEnv(process.env);

export function getCorsAllowedOrigins(configuration: BackendEnv = env): string[] {
  return configuration.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
}
