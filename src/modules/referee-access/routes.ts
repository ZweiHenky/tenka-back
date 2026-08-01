import { Router } from 'express'
import { refereeAccessController } from './controller'
import { refereeReadLimiter, refereeWriteLimiter } from '../../middlewares/rateLimits'

const router = Router()

router.get('/partido', refereeReadLimiter, refereeAccessController.getPartidoByToken)
router.patch('/partido/result', refereeWriteLimiter, refereeAccessController.updateResultByToken)

export { router as refereeAccessRouter }
