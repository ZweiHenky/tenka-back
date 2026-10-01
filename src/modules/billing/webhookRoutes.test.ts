import { createHmac } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { env, type BackendEnv } from '../../config/env';
import { errorHandler } from '../../middlewares/errorHandler';
import { createRevenueCatWebhookRouter, webhookRouteInternals } from './webhookRoutes';

const currentSecret = 'current-revenuecat-webhook-secret-123456';
const previousSecret = 'previous-revenuecat-webhook-secret-12345';
const signingSecret = 'revenuecat-webhook-signing-secret-123456';
const payload = { event: { id: 'event-1', type: 'INITIAL_PURCHASE', app_user_id: 'billing_account-1' } };

function signature(body: string | Buffer, timestamp = Math.floor(Date.now() / 1000)): string {
  const value = createHmac('sha256', signingSecret).update(`${timestamp}.`).update(body).digest('hex');
  return `t=${timestamp},v1=${value}`;
}

function configuration(overrides: Partial<BackendEnv> = {}): BackendEnv {
  return {
    ...env,
    BILLING_REVENUECAT_ENABLED: true,
    REVENUECAT_WEBHOOK_SECRET: currentSecret,
    REVENUECAT_WEBHOOK_PREVIOUS_SECRET: previousSecret,
    REVENUECAT_WEBHOOK_SIGNING_SECRET: undefined,
    REVENUECAT_WEBHOOK_SIGNATURE_MODE: 'disabled',
    REVENUECAT_WEBHOOK_SIGNATURE_OBSERVE_UNTIL: undefined,
    REVENUECAT_WEBHOOK_BODY_LIMIT: '256kb',
    ...overrides,
  };
}

type RouterDependencies = NonNullable<Parameters<typeof createRevenueCatWebhookRouter>[0]>;
type IngestWebhook = NonNullable<RouterDependencies['ingest']>;

function setup(input: {
  configuration?: BackendEnv;
  ingest?: IngestWebhook;
} = {}) {
  const ingest = vi.fn(input.ingest ?? (async () => 'ACCEPTED' as const));
  const app = express();
  app.use('/api/webhooks/revenuecat', createRevenueCatWebhookRouter({
    configuration: input.configuration ?? configuration(),
    limiter: (_req, _res, next) => next(),
    ingest,
  }));
  app.use(errorHandler);
  return { app, ingest };
}

describe('RevenueCat webhook route', () => {
  it('diagnoses authorization mismatches without exposing credentials', () => {
    const diagnostics = webhookRouteInternals.authorizationDiagnostics(
      'Bearer received-secret',
    );
    expect(diagnostics).toEqual({
      headerPresent: true,
      bearerFormatValid: true,
    });
    expect(JSON.stringify(diagnostics)).not.toContain('secret');
  });

  it.each([
    ['ACCEPTED'], ['DUPLICATE'], ['CONFLICT'],
  ] as const)('returns 200 after durable result %s', async (status) => {
    const { app, ingest } = setup({ ingest: vi.fn().mockResolvedValue(status) });
    const response = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', `Bearer ${currentSecret}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { status } });
    expect(ingest).toHaveBeenCalledOnce();
  });

  it('accepts the previous secret during controlled rotation', async () => {
    const { app, ingest } = setup();
    const response = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', `Bearer ${previousSecret}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));
    expect(response.status).toBe(200);
    expect(ingest).toHaveBeenCalledOnce();
  });

  it('requires and verifies HMAC over the exact raw body when configured', async () => {
    const raw = JSON.stringify(payload);
    const { app, ingest } = setup({
      configuration: configuration({
        REVENUECAT_WEBHOOK_SIGNING_SECRET: signingSecret,
        REVENUECAT_WEBHOOK_SIGNATURE_MODE: 'enforce',
      }),
    });
    const response = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', `Bearer ${currentSecret}`)
      .set('X-RevenueCat-Webhook-Signature', signature(raw))
      .set('Content-Type', 'application/json')
      .send(raw);
    expect(response.status).toBe(200);
    expect(ingest).toHaveBeenCalledOnce();
  });

  it.each([
    ['missing', undefined, JSON.stringify(payload)],
    ['malformed', 't=invalid,v1=invalid', JSON.stringify(payload)],
    ['tampered', signature(JSON.stringify(payload)), JSON.stringify({ ...payload, changed: true })],
    ['expired', signature(JSON.stringify(payload), Math.floor(Date.now() / 1000) - 301), JSON.stringify(payload)],
    ['future', signature(JSON.stringify(payload), Math.floor(Date.now() / 1000) + 302), JSON.stringify(payload)],
  ])('rejects %s HMAC without persistence', async (_case, webhookSignature, body) => {
    const { app, ingest } = setup({
      configuration: configuration({
        REVENUECAT_WEBHOOK_SIGNING_SECRET: signingSecret,
        REVENUECAT_WEBHOOK_SIGNATURE_MODE: 'enforce',
      }),
    });
    const operation = request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', `Bearer ${currentSecret}`)
      .set('Content-Type', 'application/json');
    if (webhookSignature) operation.set('X-RevenueCat-Webhook-Signature', webhookSignature);
    const response = await operation.send(body);
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('No autorizado');
    expect(ingest).not.toHaveBeenCalled();
  });

  it('observes invalid HMAC without rejecting the delivery', async () => {
    const { app, ingest } = setup({
      configuration: configuration({
        REVENUECAT_WEBHOOK_SIGNING_SECRET: signingSecret,
        REVENUECAT_WEBHOOK_SIGNATURE_MODE: 'observe',
        REVENUECAT_WEBHOOK_SIGNATURE_OBSERVE_UNTIL: new Date(Date.now() + 60 * 60_000).toISOString(),
      }),
    });
    const response = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', `Bearer ${currentSecret}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));
    expect(response.status).toBe(200);
    expect(ingest).toHaveBeenCalledOnce();
  });

  it('automatically enforces HMAC after the observe deadline', async () => {
    const { app, ingest } = setup({
      configuration: configuration({
        REVENUECAT_WEBHOOK_SIGNING_SECRET: signingSecret,
        REVENUECAT_WEBHOOK_SIGNATURE_MODE: 'observe',
        REVENUECAT_WEBHOOK_SIGNATURE_OBSERVE_UNTIL: new Date(Date.now() - 1).toISOString(),
      }),
    });
    const response = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', `Bearer ${currentSecret}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));
    expect(response.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('rejects compressed bodies before parsing or signature verification', async () => {
    const raw = Buffer.from(JSON.stringify(payload));
    const compressed = gzipSync(raw);
    const { app, ingest } = setup({
      configuration: configuration({
        REVENUECAT_WEBHOOK_SIGNING_SECRET: signingSecret,
        REVENUECAT_WEBHOOK_SIGNATURE_MODE: 'enforce',
      }),
    });
    const response = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', `Bearer ${currentSecret}`)
      .set('X-RevenueCat-Webhook-Signature', signature(compressed))
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      .send(compressed);
    expect(response.status).toBe(415);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('parses the signature strictly and applies the timestamp boundary', () => {
    const raw = Buffer.from(JSON.stringify(payload));
    const now = 1_800_000_000_000;
    const timestamp = now / 1000 - 300;
    const header = signature(raw.toString(), timestamp);
    expect(webhookRouteInternals.parseWebhookSignature(header)).toMatchObject({ timestamp });
    expect(webhookRouteInternals.validWebhookSignature(raw, header, signingSecret, now)).toBe(true);
    expect(webhookRouteInternals.validWebhookSignature(raw, header, signingSecret, now + 1)).toBe(false);
    expect(webhookRouteInternals.parseWebhookSignature(`${header},v1=${'a'.repeat(64)}`)).toBeNull();
    expect(webhookRouteInternals.parseWebhookSignature(header.replace('v1=', 'v2='))).toBeNull();
    expect(webhookRouteInternals.parseWebhookSignature(header.replace(`t=${timestamp}`, `t=0${timestamp}`))).toBeNull();
  });

  it.each([
    undefined,
    'Basic value',
    'Bearer incorrect-secret-value-that-is-long-enough',
  ])('rejects invalid authorization without persistence', async (authorization) => {
    const { app, ingest } = setup();
    const operation = request(app).post('/api/webhooks/revenuecat').set('Content-Type', 'application/json');
    if (authorization) operation.set('Authorization', authorization);
    const response = await operation.send(JSON.stringify(payload));
    expect(response.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('returns 503 without reading the body when the integration is disabled', async () => {
    const { app, ingest } = setup({ configuration: configuration({ BILLING_REVENUECAT_ENABLED: false }) });
    const response = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', `Bearer ${currentSecret}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));
    expect(response.status).toBe(503);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid event', async () => {
    const { app, ingest } = setup();
    const response = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', `Bearer ${currentSecret}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ event: { type: 'RENEWAL' } }));
    expect(response.status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('returns 413 when the route-specific body limit is exceeded', async () => {
    const { app, ingest } = setup({ configuration: configuration({ REVENUECAT_WEBHOOK_BODY_LIMIT: '1kb' }) });
    const response = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', `Bearer ${currentSecret}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ ...payload, padding: 'x'.repeat(2_000) }));
    expect(response.status).toBe(413);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('returns 503 when persistence fails before acknowledgement', async () => {
    const { app } = setup({ ingest: vi.fn().mockRejectedValue(new Error('private database error')) });
    const response = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', `Bearer ${currentSecret}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('private');
  });
});
