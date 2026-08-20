import { Router } from 'express';
import { requireAuth } from '../../middlewares/authMiddleware';
import { destructiveOperationLimiter } from '../../middlewares/rateLimits';
import { userController } from './controller';

const router = Router();

router.use(requireAuth);
router.post('/me/activate-league-role', userController.activateLeagueRole);
router.patch('/me', userController.updateMe);
router.patch('/me/phone-visibility', userController.updatePhoneVisibility);
router.delete('/me', destructiveOperationLimiter, userController.deleteAccount);

export { router as userRouter };
