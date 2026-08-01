import { Router } from 'express';
import { premioController } from './controller';
import { optionalAuth, requireAuth } from '../../middlewares/authMiddleware';

const router = Router();

router.get('/', optionalAuth, premioController.list);
router.get('/division/:divisionId', optionalAuth, premioController.findByDivision);
router.get('/:id', optionalAuth, premioController.getById);
router.use(requireAuth);
router.post('/', premioController.create);
router.patch('/:id', premioController.update);
router.delete('/:id', premioController.delete);

export { router as premioRouter };
