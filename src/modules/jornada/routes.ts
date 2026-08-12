import { Router } from 'express';
import { jornadaController } from './controller';
import { optionalAuth, requireAuth } from '../../middlewares/authMiddleware';
import { expensiveOperationLimiter } from '../../middlewares/rateLimits';

const router = Router();

router.get('/', optionalAuth, jornadaController.list);
router.get('/division/:divisionId', optionalAuth, jornadaController.findByDivision);
router.get('/:id', optionalAuth, jornadaController.getById);
router.use(requireAuth);
router.post('/generate-next/:divisionId', expensiveOperationLimiter, jornadaController.generateNext);
router.delete('/:id', expensiveOperationLimiter, jornadaController.delete);

export { router as jornadaRouter };
