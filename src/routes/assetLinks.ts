import { Router } from 'express';

const PREVIEW_ANDROID_CERTIFICATE_SHA256 = '75:94:2B:19:DA:D8:8B:13:35:04:4B:40:C9:30:93:52:77:65:62:C2:5B:66:5E:49:10:05:A6:E4:E3:52:E0:01';

export function createAssetLinksRouter() {
  const router = Router();

  router.get('/.well-known/assetlinks.json', (_req, res) => {
    res.json([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'studio.tenka.app',
          sha256_cert_fingerprints: [PREVIEW_ANDROID_CERTIFICATE_SHA256],
        },
      },
    ]);
  });

  return router;
}
