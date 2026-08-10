import { Router } from 'express';
import { requireAuth } from '../../middlewares/authMiddleware';
import { disponibilidadCanchaController } from './controller';

const router = Router();

router.get('/:ligaId/disponibilidad-canchas', requireAuth, disponibilidadCanchaController.get);

export { router as disponibilidadCanchaRouter };
