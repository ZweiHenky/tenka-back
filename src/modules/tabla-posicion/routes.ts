import { Router } from 'express';
import { tablaPosicionController } from './controller';
import { optionalAuth, requireAuth } from '../../middlewares/authMiddleware';

const router = Router();

router.get('/division/:divisionId', optionalAuth, tablaPosicionController.findByDivision);
router.get('/:divisionId/:equipoId', optionalAuth, tablaPosicionController.findOne);
router.use(requireAuth);
router.post('/', tablaPosicionController.upsert);
router.delete('/:divisionId/:equipoId', tablaPosicionController.delete);

export { router as tablaPosicionRouter };
