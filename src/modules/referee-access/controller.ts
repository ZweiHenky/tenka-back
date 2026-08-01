import type { Request, Response, NextFunction } from 'express'
import { refereeAccessService } from './service'
import { refereeResultSchema } from './validator'
import { ok, noContent, created } from '../../utils/response'
import { ValidationError } from '../../utils/errors'

export const refereeAccessController = {
  async createAccess(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await refereeAccessService.createAccess(req.params.id, req.user!)
      created(res, result, 'Enlace de árbitro generado')
    } catch (e) { next(e) }
  },

  async revokeAccess(req: Request, res: Response, next: NextFunction) {
    try {
      await refereeAccessService.revokeAccess(req.params.id, req.user!)
      noContent(res)
    } catch (e) { next(e) }
  },

  async getLinkStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const status = await refereeAccessService.getLinkStatus(req.params.id, req.user!)
      ok(res, status)
    } catch (e) { next(e) }
  },

  async getPartidoByToken(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await refereeAccessService.getPartidoByToken(req.headers.authorization)
      ok(res, data)
    } catch (e) { next(e) }
  },

  async updateResultByToken(req: Request, res: Response, next: NextFunction) {
    try {
      const p = refereeResultSchema.safeParse(req.body)
      if (!p.success) throw new ValidationError(p.error.issues[0].message)
      const data = await refereeAccessService.updateResultByToken(req.headers.authorization, p.data)
      ok(res, data, 'Resultado guardado exitosamente')
    } catch (e) { next(e) }
  },
}
