import { Router } from 'express';
import { divisionController } from './controller';
import { optionalAuth, requireAuth } from '../../middlewares/authMiddleware';
import { expensiveOperationLimiter } from '../../middlewares/rateLimits';

const router = Router();

router.get('/', optionalAuth, divisionController.list);
router.get('/por-liga/:ligaId', optionalAuth, divisionController.listByLiga);
router.get('/:id', optionalAuth, divisionController.getById);
router.use(requireAuth);
router.post('/', divisionController.create);
router.patch('/:id', divisionController.update);
router.delete('/:id', expensiveOperationLimiter, divisionController.delete);
router.post('/:id/reset', expensiveOperationLimiter, divisionController.reset);

export { router as divisionRouter };
