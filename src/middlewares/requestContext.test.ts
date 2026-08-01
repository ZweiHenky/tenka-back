import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { requestContext } from './requestContext';

function createTestApp() {
  const app = express();
  app.use(requestContext);
  app.get('/', (req, res) => res.json({ requestId: req.requestId }));
  return app;
}

describe('requestContext', () => {
  it('preserves a valid incoming request ID', async () => {
    const requestId = 'client.request-123:retry_2';
    const response = await request(createTestApp()).get('/').set('x-request-id', requestId);

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe(requestId);
    expect(response.body).toEqual({ requestId });
  });

  it('generates a request ID for an invalid incoming value', async () => {
    const response = await request(createTestApp()).get('/').set('x-request-id', 'invalid request id');
    const generatedId = response.headers['x-request-id'];

    expect(response.status).toBe(200);
    expect(generatedId).not.toBe('invalid request id');
    expect(generatedId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(response.body).toEqual({ requestId: generatedId });
  });
});
