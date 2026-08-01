import { Router } from 'express';
import { ubicacionController } from './controller';
import { requireAuth, requireRole } from '../../middlewares/authMiddleware';

const router = Router();

router.get('/', ubicacionController.list);
router.get('/:id', ubicacionController.getById);
router.use(requireAuth);
router.post('/find-or-create', requireRole('CAPITAN', 'LIGA'), ubicacionController.findOrCreate);
router.post('/', requireRole('CAPITAN', 'LIGA'), ubicacionController.create);
router.patch('/:id', requireRole('ADMINISTRADOR'), ubicacionController.update);
router.delete('/:id', requireRole('ADMINISTRADOR'), ubicacionController.delete);

export { router as ubicacionRouter };
