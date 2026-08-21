import { Request, Response, NextFunction } from 'express';
import { tipoCompetenciaService } from './service';
import { createSchema, updateSchema } from './validator';
import { ok, created, noContent } from '../../utils/response';
import { ValidationError } from '../../utils/errors';
import { firstIssueMessage } from '../../utils/validation';

export const tipoCompetenciaController = {
  async list(_req: Request, res: Response, next: NextFunction) {
    try { ok(res, await tipoCompetenciaService.list()); } catch (e) { next(e); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await tipoCompetenciaService.getById(req.params.id)); } catch (e) { next(e); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try { const p = createSchema.safeParse(req.body); if (!p.success) throw new ValidationError(firstIssueMessage(p.error)); created(res, await tipoCompetenciaService.create(p.data), 'Tipo de competencia creado exitosamente'); } catch (e) { next(e); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try { const p = updateSchema.safeParse(req.body); if (!p.success) throw new ValidationError(firstIssueMessage(p.error)); ok(res, await tipoCompetenciaService.update(req.params.id, p.data), 'Tipo de competencia actualizado exitosamente'); } catch (e) { next(e); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try { await tipoCompetenciaService.delete(req.params.id); noContent(res); } catch (e) { next(e); }
  },
};
