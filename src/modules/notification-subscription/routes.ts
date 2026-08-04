import { Router } from 'express';
import { notificationSubscriptionController } from './controller';
import { subscriptionLimiter } from '../../middlewares/rateLimits';
import { optionalAuth } from '../../middlewares/authMiddleware';

const router = Router();

router.post('/subscribe', subscriptionLimiter, optionalAuth, notificationSubscriptionController.subscribe);
router.post('/unsubscribe', subscriptionLimiter, optionalAuth, notificationSubscriptionController.unsubscribe);

export { router as notificationSubscriptionRouter };
