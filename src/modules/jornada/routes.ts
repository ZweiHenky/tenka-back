import { Router } from 'express';
import { jornadaController } from './controller';
import { optionalAuth, requireAuth } from '../../middlewares/authMiddleware';
import { destructiveOperationLimiter, jornadaGenerationLimiter } from '../../middlewares/rateLimits';

const router = Router();

router.get('/', optionalAuth, jornadaController.list);
router.get('/division/:divisionId', optionalAuth, jornadaController.findByDivision);
router.get('/:id', optionalAuth, jornadaController.getById);
router.use(requireAuth);
router.post('/generate-next/:divisionId', jornadaGenerationLimiter, jornadaController.generateNext);
router.delete('/:id', destructiveOperationLimiter, jornadaController.delete);

export { router as jornadaRouter };
