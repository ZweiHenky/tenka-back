import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../utils/errors';
import { errorHandler } from './errorHandler';
import { requestContext } from './requestContext';

function createTestApp(error: Error) {
  const app = express();
  app.use(requestContext);
  app.get('/', () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('returns a generic 500 with the request ID and no internal details', async () => {
    const response = await request(createTestApp(new Error('secret implementation detail')))
      .get('/')
      .set('x-request-id', 'request-500');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: 'Error interno del servidor',
      requestId: 'request-500',
    });
    expect(JSON.stringify(response.body)).not.toContain('secret implementation detail');
    expect(response.body).not.toHaveProperty('stack');
  });

  it('uses an AppError status and safe message', async () => {
    const response = await request(createTestApp(new AppError(422, 'Solicitud no procesable')))
      .get('/')
      .set('x-request-id', 'request-app-error');

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      success: false,
      error: 'Solicitud no procesable',
      requestId: 'request-app-error',
    });
  });

  it.each([
    [new UnauthorizedError(), 401],
    [new ForbiddenError(), 403],
    [new NotFoundError('Ruta'), 404],
    [new ConflictError('Recurso duplicado'), 409],
    [new ValidationError('Datos invalidos'), 422],
  ])('normalizes %s as HTTP %s', async (error, status) => {
    const response = await request(createTestApp(error)).get('/').set('x-request-id', `request-${status}`);
    expect(response.status).toBe(status);
    expect(response.body).toMatchObject({ success: false, error: error.message, requestId: `request-${status}` });
  });

  it('normalizes malformed and oversized JSON bodies', async () => {
    const app = express();
    app.use(requestContext);
    app.use(express.json({ limit: '10b' }));
    app.post('/', (_req, res) => res.sendStatus(204));
    app.use(errorHandler);

    const malformed = await request(app).post('/').set('content-type', 'application/json').send('{');
    expect(malformed.status).toBe(400);
    expect(malformed.body).toMatchObject({ success: false, error: 'JSON invalido' });

    const oversized = await request(app).post('/').send({ value: 'more-than-ten-bytes' });
    expect(oversized.status).toBe(413);
    expect(oversized.body).toMatchObject({ success: false, error: 'El cuerpo de la solicitud es demasiado grande' });
  });
});
