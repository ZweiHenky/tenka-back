import { Router } from 'express';
import { ligaController } from './controller';
import { optionalAuth, requireAuth, requireRole } from '../../middlewares/authMiddleware';
import { arbitrajeController } from '../arbitraje/controller';
import { destructiveOperationLimiter } from '../../middlewares/rateLimits';

const router = Router();

router.get('/', optionalAuth, ligaController.list);
router.get('/:id', optionalAuth, ligaController.getById);
router.use(requireAuth);
router.post('/', requireRole('LIGA'), ligaController.create);
router.patch('/:id', ligaController.update);
router.delete('/:id', destructiveOperationLimiter, ligaController.delete);

router.get('/:ligaId/programacion-reciente', ligaController.getRecentSchedule);

router.get('/:ligaId/canchas', ligaController.listCanchas);
router.post('/:ligaId/canchas', ligaController.createCancha);
router.patch('/:ligaId/canchas/:canchaId', ligaController.updateCancha);
router.delete('/:ligaId/canchas/:canchaId', ligaController.deleteCancha);

router.get('/:ligaId/arbitros', ligaController.listArbitros);
router.post('/:ligaId/arbitros', ligaController.createArbitro);
router.patch('/:ligaId/arbitros/:arbitroId', ligaController.updateArbitro);
router.delete('/:ligaId/arbitros/:arbitroId', ligaController.deleteArbitro);

router.get('/:ligaId/tandas-arbitrales', arbitrajeController.list);
router.get('/:ligaId/tandas-arbitrales/:tandaId', arbitrajeController.detail);
router.get('/:ligaId/candidatos-arbitraje', arbitrajeController.candidates);
router.put('/:ligaId/asignaciones-arbitros', arbitrajeController.replaceLeagueAssignments);
router.delete('/:ligaId/asignaciones-arbitros/:asignacionId', arbitrajeController.removeAssignment);

export { router as ligaRouter };
