import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createSharedLinkFallbackRouter } from './sharedLinkFallback';

describe('shared link fallback', () => {
  it.each([
    ['/liga/liga-1', 'https://tenka.studio/liga/liga-1'],
    ['/equipo/equipo-1/division/division-1?tab=plantel', 'https://tenka.studio/equipo/equipo-1/division/division-1?tab=plantel'],
  ])('redirige %s a la landing pública en preview', async (path, expectedLocation) => {
    const app = express();
    app.use(createSharedLinkFallbackRouter('preview'));

    const response = await request(app).get(path).expect(302);

    expect(response.headers.location).toBe(expectedLocation);
  });

  it('no intercepta enlaces fuera de preview', async () => {
    const app = express();
    app.use(createSharedLinkFallbackRouter('production'));

    await request(app).get('/liga/liga-1').expect(404);
  });
});
