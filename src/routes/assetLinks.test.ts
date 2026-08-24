import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createAssetLinksRouter } from './assetLinks';

describe('Digital Asset Links', () => {
  it('publica la asociación de la app preview sin redirecciones', async () => {
    const app = express();
    app.use(createAssetLinksRouter());

    const response = await request(app).get('/.well-known/assetlinks.json').expect(200);

    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.redirect).toBe(false);
    expect(response.body).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'studio.tenka.app',
          sha256_cert_fingerprints: [
            '75:94:2B:19:DA:D8:8B:13:35:04:4B:40:C9:30:93:52:77:65:62:C2:5B:66:5E:49:10:05:A6:E4:E3:52:E0:01',
          ],
        },
      },
    ]);
  });
});
