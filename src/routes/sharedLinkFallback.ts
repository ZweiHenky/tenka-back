import { Router } from 'express';

type AppEnv = 'local' | 'preview' | 'production';

export function createSharedLinkFallbackRouter(appEnv: AppEnv) {
  const router = Router();

  router.get(/^\/(?:liga|equipo)(?:\/.*)?$/, (req, res, next) => {
    if (appEnv !== 'preview') return next();
    return res.redirect(302, `https://tenka.studio${req.originalUrl}`);
  });

  return router;
}
