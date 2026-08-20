import { Router } from 'express';
import { equipoController } from './controller';
import { optionalAuth, requireAuth, requireRole } from '../../middlewares/authMiddleware';
import { destructiveOperationLimiter } from '../../middlewares/rateLimits';

const router = Router();

router.get('/', optionalAuth, equipoController.list);
router.get('/:id', optionalAuth, equipoController.getById);
router.use(requireAuth);
router.post('/', requireRole('CAPITAN', 'LIGA'), equipoController.create);
router.patch('/:id', equipoController.update);
router.delete('/:id', destructiveOperationLimiter, equipoController.delete);

export { router as equipoRouter };
