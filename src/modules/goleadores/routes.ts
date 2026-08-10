import { Router } from 'express'
import { optionalAuth } from '../../middlewares/authMiddleware'
import { goleadoresController } from './controller'

const router = Router()
router.get('/division/:divisionId', optionalAuth, goleadoresController.findByDivision)

export { router as goleadoresRouter }
