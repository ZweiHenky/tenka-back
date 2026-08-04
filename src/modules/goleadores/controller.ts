import type { NextFunction, Request, Response } from 'express'
import { ok } from '../../utils/response'
import { goleadoresService } from './service'

export const goleadoresController = {
  async findByDivision(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await goleadoresService.findByDivision(req.params.divisionId, req.user)) } catch (error) { next(error) }
  },
}
