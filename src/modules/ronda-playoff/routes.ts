import { Router } from 'express';
import { rondaPlayoffController } from './controller';
import { optionalAuth, requireAuth } from '../../middlewares/authMiddleware';

const router = Router();

router.get('/', optionalAuth, rondaPlayoffController.list);
router.get('/division/:divisionId', optionalAuth, rondaPlayoffController.findByDivision);
router.get('/:id', optionalAuth, rondaPlayoffController.getById);
router.use(requireAuth);
router.post('/', rondaPlayoffController.create);
router.post('/generate', rondaPlayoffController.generate);
router.patch('/:id', rondaPlayoffController.update);
router.delete('/division/:divisionId', rondaPlayoffController.deleteByDivision);
router.delete('/:id', rondaPlayoffController.delete);

export { router as rondaPlayoffRouter };
