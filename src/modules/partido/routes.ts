import { Router } from 'express';
import { partidoController } from './controller';
import { refereeAccessController } from '../referee-access/controller';
import { optionalAuth, requireAuth } from '../../middlewares/authMiddleware';

const router = Router();

router.get('/', optionalAuth, partidoController.list);
router.get('/jornada/:jornadaId', optionalAuth, partidoController.findByJornada);
router.get('/ronda-playoff/:rondaPlayoffId', optionalAuth, partidoController.findByRondaPlayoff);
router.get('/:id', optionalAuth, partidoController.getById);
router.use(requireAuth);
router.post('/', partidoController.create);
router.patch('/:id', partidoController.update);
router.delete('/:id', partidoController.delete);
router.post('/:id/referee-link', refereeAccessController.createAccess);
router.delete('/:id/referee-link', refereeAccessController.revokeAccess);
router.get('/:id/referee-link-status', partidoController.getRefereeLinkStatus);

export { router as partidoRouter };
