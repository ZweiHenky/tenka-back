import { Router } from 'express';
import { equipoController } from './controller';
import { requireAuth, requireRole } from '../../middlewares/authMiddleware';

const router = Router();

router.get('/', equipoController.list);
router.get('/:id', equipoController.getById);
router.use(requireAuth);
router.post('/', requireRole('CAPITAN', 'LIGA'), equipoController.create);
router.patch('/:id', equipoController.update);
router.delete('/:id', equipoController.delete);

export { router as equipoRouter };
