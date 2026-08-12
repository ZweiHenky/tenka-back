import { Router } from 'express';
import { rondaPlayoffController } from './controller';
import { optionalAuth, requireAuth } from '../../middlewares/authMiddleware';
import { expensiveOperationLimiter } from '../../middlewares/rateLimits';

const router = Router();

router.get('/', optionalAuth, rondaPlayoffController.list);
router.get('/division/:divisionId', optionalAuth, rondaPlayoffController.findByDivision);
router.get('/:id', optionalAuth, rondaPlayoffController.getById);
router.use(requireAuth);
router.post('/', rondaPlayoffController.create);
router.post('/generate', expensiveOperationLimiter, rondaPlayoffController.generate);
router.patch('/:id', rondaPlayoffController.update);
router.delete('/division/:divisionId', expensiveOperationLimiter, rondaPlayoffController.deleteByDivision);
router.delete('/:id', expensiveOperationLimiter, rondaPlayoffController.delete);

export { router as rondaPlayoffRouter };
