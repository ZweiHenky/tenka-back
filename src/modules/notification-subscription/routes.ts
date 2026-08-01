import { Router } from 'express';
import { notificationSubscriptionController } from './controller';
import { subscriptionLimiter } from '../../middlewares/rateLimits';

const router = Router();

router.post('/subscribe', subscriptionLimiter, notificationSubscriptionController.subscribe);
router.post('/unsubscribe', subscriptionLimiter, notificationSubscriptionController.unsubscribe);

export { router as notificationSubscriptionRouter };
