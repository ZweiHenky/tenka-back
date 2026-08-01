import { Router } from 'express';
import { divisionEquipoController } from './controller';
import { optionalAuth, requireAuth } from '../../middlewares/authMiddleware';

const router = Router();

router.get('/division/:divisionId', optionalAuth, divisionEquipoController.findByDivision);
router.get('/equipo/:equipoId', optionalAuth, divisionEquipoController.findByEquipo);
router.use(requireAuth);
router.post('/', divisionEquipoController.create);
router.patch('/:divisionId/:equipoId', divisionEquipoController.updateSaldoPendiente);
router.delete('/:divisionId/:equipoId', divisionEquipoController.delete);

export { router as divisionEquipoRouter };
