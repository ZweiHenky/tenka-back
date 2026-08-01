import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/database', () => ({
  prisma: { $queryRawUnsafe: vi.fn() },
}));

import { createHealthRouter } from './health';

function createTestApp(overrides: Parameters<typeof createHealthRouter>[0] = {}) {
  const app = express();
  app.use(createHealthRouter(overrides));
  return app;
}

describe('createHealthRouter', () => {
  it('reports the service as live', async () => {
    const response = await request(createTestApp()).get('/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('keeps the legacy health alias live', async () => {
    const response = await request(createTestApp()).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('reports readiness after a successful database check', async () => {
    const checkDatabase = vi.fn().mockResolvedValue(undefined);
    const response = await request(createTestApp({ checkDatabase, isReady: () => true })).get('/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready' });
    expect(checkDatabase).toHaveBeenCalledOnce();
  });

  it('returns 503 without database failure details', async () => {
    const response = await request(createTestApp({
      checkDatabase: () => Promise.reject(new Error('password exposed in database error')),
      isReady: () => true,
    })).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready', reason: 'database_error' });
    expect(JSON.stringify(response.body)).not.toContain('password exposed');
    expect(response.body).not.toHaveProperty('stack');
  });

  it('returns 503 when the database check times out', async () => {
    const response = await request(createTestApp({
      checkDatabase: () => new Promise(() => undefined),
      isReady: () => true,
      timeoutMs: 5,
    })).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready', reason: 'database_timeout' });
  });

  it('returns 503 without checking the database while shutting down', async () => {
    const checkDatabase = vi.fn().mockResolvedValue(undefined);
    const response = await request(createTestApp({ checkDatabase, isReady: () => false })).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready', reason: 'shutting_down' });
    expect(checkDatabase).not.toHaveBeenCalled();
  });
});
