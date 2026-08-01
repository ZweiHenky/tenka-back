import { Router } from 'express';
import { estadoLigaController } from './controller';
import { requireAuth, requireRole } from '../../middlewares/authMiddleware';

const router = Router();

router.get('/', estadoLigaController.list);
router.get('/:id', estadoLigaController.getById);
router.use(requireAuth, requireRole('ADMINISTRADOR'));
router.post('/', estadoLigaController.create);
router.patch('/:id', estadoLigaController.update);
router.delete('/:id', estadoLigaController.delete);

export { router as estadoLigaRouter };
