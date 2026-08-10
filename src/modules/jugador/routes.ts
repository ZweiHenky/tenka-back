import { Router } from 'express';
import { optionalAuth, requireAuth, requireRole } from '../../middlewares/authMiddleware';
import { jugadorController } from './controller';
import { playerPhoneLookupLimiter } from '../../middlewares/rateLimits';

const router = Router();

router.get('/', jugadorController.list);
router.get('/me', requireAuth, jugadorController.getMe);
router.get('/:jugadorId/divisiones', optionalAuth, jugadorController.listDivisionsByPlayer);
router.get('/division/:divisionId/equipo/:equipoId', optionalAuth, jugadorController.listByDivisionTeam);
router.get('/:id', jugadorController.getById);

router.use(requireAuth);
router.post('/me', jugadorController.createMe);
router.patch('/me', jugadorController.updateMe);
router.post(
  '/equipo/:equipoId/buscar',
  requireRole('CAPITAN', 'LIGA'),
  playerPhoneLookupLimiter,
  jugadorController.lookupByPhone,
);
router.post('/', requireRole('CAPITAN', 'LIGA'), jugadorController.create);
router.patch('/:id', requireRole('CAPITAN', 'LIGA'), jugadorController.update);
router.delete('/:id', jugadorController.delete);
router.post('/equipo', requireRole('CAPITAN', 'LIGA'), jugadorController.assignToTeam);
router.delete('/equipo/:equipoId/:jugadorId', requireRole('CAPITAN', 'LIGA'), jugadorController.removeFromTeam);
router.post('/division', requireRole('CAPITAN', 'LIGA'), jugadorController.assignToDivision);
router.delete('/division/:divisionId/:equipoId/:jugadorId', requireRole('CAPITAN', 'LIGA'), jugadorController.removeFromDivision);

export { router as jugadorRouter };
