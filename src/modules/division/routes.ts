import { Router } from 'express';
import { divisionController } from './controller';
import { optionalAuth, requireAuth } from '../../middlewares/authMiddleware';

const router = Router();

router.get('/', optionalAuth, divisionController.list);
router.get('/por-liga/:ligaId', optionalAuth, divisionController.listByLiga);
router.get('/:id', optionalAuth, divisionController.getById);
router.use(requireAuth);
router.post('/', divisionController.create);
router.patch('/:id', divisionController.update);
router.delete('/:id', divisionController.delete);
router.post('/:id/reset', divisionController.reset);

export { router as divisionRouter };
