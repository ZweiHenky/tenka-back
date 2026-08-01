import { Router } from 'express';
import { requireAuth } from '../../middlewares/authMiddleware';
import { userController } from './controller';

const router = Router();

router.use(requireAuth);
router.post('/me/activate-league-role', userController.activateLeagueRole);
router.patch('/me', userController.updateMe);
router.patch('/me/phone-visibility', userController.updatePhoneVisibility);

export { router as userRouter };
