import { Router } from 'express'
import { optionalAuth } from '../../middlewares/authMiddleware'
import { elegibilidadController } from './controller'

const router = Router()
router.get('/division/:divisionId', optionalAuth, elegibilidadController.findByDivision)

export { router as elegibilidadRouter }
