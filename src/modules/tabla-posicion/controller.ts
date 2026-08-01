import { Request, Response, NextFunction } from 'express';
import { tablaPosicionService } from './service';
import { createSchema, updateSchema } from './validator';
import { ok, created, noContent } from '../../utils/response';
import { ValidationError } from '../../utils/errors';

export const tablaPosicionController = {
  async findByDivision(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await tablaPosicionService.findByDivision(req.params.divisionId, req.user)); } catch (e) { next(e); }
  },

  async findOne(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await tablaPosicionService.findOne(req.params.divisionId, req.params.equipoId, req.user)); } catch (e) { next(e); }
  },

  async upsert(req: Request, res: Response, next: NextFunction) {
    try { const p = createSchema.safeParse(req.body); if (!p.success) throw new ValidationError(p.error.issues[0].message); ok(res, await tablaPosicionService.upsert(p.data.divisionId, p.data.equipoId, p.data, req.user!), 'Posición actualizada exitosamente'); } catch (e) { next(e); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try { await tablaPosicionService.delete(req.params.divisionId, req.params.equipoId, req.user!); noContent(res); } catch (e) { next(e); }
  },
};
