import type { NextFunction, Request, Response } from 'express'
import { ok } from '../../utils/response'
import { elegibilidadService } from './service'

export const elegibilidadController = {
  async findByDivision(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await elegibilidadService.findByDivision(req.params.divisionId, req.user)) } catch (error) { next(error) }
  },
}
