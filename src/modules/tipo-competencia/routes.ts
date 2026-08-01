import { Router } from 'express';
import { tipoCompetenciaController } from './controller';
import { requireAuth, requireRole } from '../../middlewares/authMiddleware';

const router = Router();

router.get('/', tipoCompetenciaController.list);
router.get('/:id', tipoCompetenciaController.getById);
router.use(requireAuth, requireRole('ADMINISTRADOR'));
router.post('/', tipoCompetenciaController.create);
router.patch('/:id', tipoCompetenciaController.update);
router.delete('/:id', tipoCompetenciaController.delete);

export { router as tipoCompetenciaRouter };
