import { Router } from 'express';
import { campeonController } from './controller';
import { optionalAuth, requireAuth } from '../../middlewares/authMiddleware';

const router = Router();

// Direccionado por división y no por id: el registro es único por división, así el cliente nunca
// necesita conocer su id y el PUT es idempotente.
router.get('/division/:divisionId', optionalAuth, campeonController.findByDivision);
router.get('/division/:divisionId/historial', optionalAuth, campeonController.findHistorialByDivision);
router.get('/equipo/:equipoId', optionalAuth, campeonController.findByEquipo);
router.get('/jugador/:jugadorId', optionalAuth, campeonController.findByJugador);
router.use(requireAuth);
router.put('/division/:divisionId', campeonController.assign);
router.delete('/division/:divisionId', campeonController.remove);

export { router as campeonRouter };
