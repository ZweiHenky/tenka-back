import { Router } from 'express';
import { categoriaController } from './controller';
import { requireAuth, requireRole } from '../../middlewares/authMiddleware';

const router = Router();

router.get('/', categoriaController.list);
router.get('/:id', categoriaController.getById);
router.use(requireAuth, requireRole('ADMINISTRADOR'));
router.post('/', categoriaController.create);
router.patch('/:id', categoriaController.update);
router.delete('/:id', categoriaController.delete);

export { router as categoriaRouter };
