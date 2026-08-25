import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { errorHandler } from './middlewares/errorHandler';
import { createRateLimiter } from './middlewares/rateLimits';
import { requestContext } from './middlewares/requestContext';
import { waitlistRepository } from './modules/waitlist/repository';

describe('API hardening', () => {
  const app = createApp();

  it('trusts exactly one proxy and sends security headers', async () => {
    expect(app.get('trust proxy')).toBe(1);
    const response = await request(app).get('/live');
    expect(response.status).toBe(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers).not.toHaveProperty('x-powered-by');
  });

  it('allows configured browser origins and native requests without Origin', async () => {
    const browser = await request(app).get('/live').set('Origin', 'http://localhost:8081');
    expect(browser.status).toBe(200);
    expect(browser.headers['access-control-allow-origin']).toBe('http://localhost:8081');
    expect(browser.headers['access-control-allow-credentials']).toBe('true');

    const native = await request(app).get('/live');
    expect(native.status).toBe(200);
    expect(native.headers).not.toHaveProperty('access-control-allow-origin');
  });

  it('rejects browser origins outside the allowlist', async () => {
    const response = await request(app).get('/live').set('Origin', 'https://evil.example.com');
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ success: false, error: 'Origen no permitido' });
    expect(response.body.requestId).toBeTypeOf('string');
  });

  it('keeps health probes outside API rate limits and normalizes unknown routes', async () => {
    const health = await request(app).get('/ready');
    expect(health.status).not.toBe(429);

    const missing = await request(app).get('/api/does-not-exist').set('x-request-id', 'request-404');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ success: false, error: 'Ruta no encontrado', requestId: 'request-404' });
  });

  it('mounts Digital Asset Links outside the API namespace', async () => {
    const response = await request(app).get('/.well-known/assetlinks.json');

    expect(response.status).toBe(200);
    expect(response.body[0].target.package_name).toBe('studio.tenka.app');
  });

  it('mounts the public waitlist endpoint with a generic idempotent response', async () => {
    const create = vi.spyOn(waitlistRepository, 'create').mockResolvedValue(undefined);

    const first = await request(app).post('/api/waitlist').send({
      email: '  Person@Example.com ',
      role: 'CAPITAN',
      source: 'LANDING_HERO',
      consent: true,
    });
    const duplicate = await request(app).post('/api/waitlist').send({
      email: 'person@example.com',
      consent: true,
    });

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ success: true, message: 'Solicitud aceptada' });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toEqual(first.body);
    expect(create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      email: 'Person@Example.com',
      emailNormalized: 'person@example.com',
    }));
    expect(create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      emailNormalized: 'person@example.com',
    }));
    create.mockRestore();
  });

  it('returns a normalized 429 response', async () => {
    const limitedApp = express();
    limitedApp.set('trust proxy', 1);
    limitedApp.use(requestContext);
    limitedApp.use(createRateLimiter({ windowMs: 60_000, limit: 1 }));
    limitedApp.get('/', (_req, res) => res.sendStatus(204));
    limitedApp.use(errorHandler);

    await request(limitedApp).get('/');
    const response = await request(limitedApp).get('/').set('x-request-id', 'request-429');
    expect(response.status).toBe(429);
    expect(response.body).toEqual({
      success: false,
      error: 'Demasiadas solicitudes. Intenta de nuevo mas tarde.',
      requestId: 'request-429',
    });
    expect(response.headers).toHaveProperty('ratelimit');
    expect(response.headers['retry-after']).toBeTypeOf('string');
  });
});
