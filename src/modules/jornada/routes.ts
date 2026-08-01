import { Router } from 'express';
import { jornadaController } from './controller';
import { optionalAuth, requireAuth } from '../../middlewares/authMiddleware';

const router = Router();

router.get('/', optionalAuth, jornadaController.list);
router.get('/division/:divisionId', optionalAuth, jornadaController.findByDivision);
router.get('/:id', optionalAuth, jornadaController.getById);
router.use(requireAuth);
router.post('/generate-next/:divisionId', jornadaController.generateNext);
router.post('/', jornadaController.create);
router.patch('/:id', jornadaController.update);
router.delete('/:id', jornadaController.delete);

export { router as jornadaRouter };
