import { Router } from 'express';
import { waitlistLimiter } from '../../middlewares/rateLimits';
import { waitlistController } from './controller';

const router = Router();

router.post('/', waitlistLimiter, waitlistController.create);

export { router as waitlistRouter };
