import { Router } from 'express';
import { rondaPlayoffController } from './controller';
import { optionalAuth, requireAuth } from '../../middlewares/authMiddleware';
import { destructiveOperationLimiter, playoffGenerationLimiter } from '../../middlewares/rateLimits';

const router = Router();

router.get('/', optionalAuth, rondaPlayoffController.list);
router.get('/division/:divisionId', optionalAuth, rondaPlayoffController.findByDivision);
router.get('/:id', optionalAuth, rondaPlayoffController.getById);
router.use(requireAuth);
router.post('/', rondaPlayoffController.create);
router.post('/generate', playoffGenerationLimiter, rondaPlayoffController.generate);
router.patch('/:id', rondaPlayoffController.update);
router.delete('/division/:divisionId', destructiveOperationLimiter, rondaPlayoffController.deleteByDivision);
router.delete('/:id', destructiveOperationLimiter, rondaPlayoffController.delete);

export { router as rondaPlayoffRouter };
