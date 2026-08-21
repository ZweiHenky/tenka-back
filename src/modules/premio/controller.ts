import { Request, Response, NextFunction } from 'express';
import { premioService } from './service';
import { createSchema, updateSchema } from './validator';
import { ok, created, noContent } from '../../utils/response';
import { ValidationError } from '../../utils/errors';
import { parsePagination } from '../../utils/pagination';
import { firstIssueMessage } from '../../utils/validation';

export const premioController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await premioService.list(parsePagination(req.query), req.user)); } catch (e) { next(e); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await premioService.getById(req.params.id, req.user)); } catch (e) { next(e); }
  },

  async findByDivision(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await premioService.findByDivision(req.params.divisionId, req.user)); } catch (e) { next(e); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try { const p = createSchema.safeParse(req.body); if (!p.success) throw new ValidationError(firstIssueMessage(p.error)); created(res, await premioService.create(p.data, req.user!), 'Premio creado exitosamente'); } catch (e) { next(e); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try { const p = updateSchema.safeParse(req.body); if (!p.success) throw new ValidationError(firstIssueMessage(p.error)); ok(res, await premioService.update(req.params.id, p.data, req.user!), 'Premio actualizado exitosamente'); } catch (e) { next(e); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try { await premioService.delete(req.params.id, req.user!); noContent(res); } catch (e) { next(e); }
  },
};
