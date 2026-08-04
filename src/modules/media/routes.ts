import { Router } from 'express';
import { requireAuth } from '../../middlewares/authMiddleware';
import { mediaController } from './controller';
import { uploadLimiter } from '../../middlewares/rateLimits';

const router = Router();

router.post('/sign-upload', requireAuth, uploadLimiter, mediaController.signUpload);
router.post('/complete', requireAuth, uploadLimiter, mediaController.complete);
router.post('/:intentId/abandon', requireAuth, mediaController.abandon);

export { router as mediaRouter };
