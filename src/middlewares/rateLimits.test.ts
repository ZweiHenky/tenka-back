import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { createRateLimiter, rateLimitActorKey, waitlistLimiter } from './rateLimits';

function testApp(withUser: boolean) {
  const app = express();
  if (withUser) {
    app.use((req, _res, next) => {
      req.user = { id: req.get('x-user-id') ?? 'user-1', email: 'test@example.com', rol: 'LIGA' };
      next();
    });
  }
  app.get('/limited', createRateLimiter({ name: `test-${withUser}`, windowMs: 60_000, limit: 1 }), (_req, res) => res.sendStatus(204));
  return app;
}

describe('rate-limit keys', () => {
  it('shares a bucket by authenticated user', async () => {
    const app = testApp(true);
    await request(app).get('/limited').set('x-user-id', 'user-1').expect(204);
    await request(app).get('/limited').set('x-user-id', 'user-1').expect(429);
    const requestFor = (id: string) => ({ user: { id }, ip: '127.0.0.1', socket: {} }) as Request;
    expect(rateLimitActorKey(requestFor('user-1'))).toBe('user:user-1');
    expect(rateLimitActorKey(requestFor('user-2'))).toBe('user:user-2');
  });

  it('falls back to the client IP when no user is available', async () => {
    const app = testApp(false);
    await request(app).get('/limited').expect(204);
    const response = await request(app).get('/limited').expect(429);
    expect(response.body.error).toContain('Demasiadas solicitudes');
    expect(rateLimitActorKey({ ip: '127.0.0.1', socket: {} } as Request)).toBe('ip:127.0.0.1');
  });
});

describe('waitlist rate limit', () => {
  it('allows five requests per IP and rejects the sixth', async () => {
    const app = express();
    app.post('/waitlist', waitlistLimiter, (_req, res) => res.sendStatus(204));

    for (let requestNumber = 0; requestNumber < 5; requestNumber += 1) {
      await request(app).post('/waitlist').expect(204);
    }
    const response = await request(app).post('/waitlist').expect(429);

    expect(response.body.error).toContain('Demasiadas solicitudes');
  });
});
