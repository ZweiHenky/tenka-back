import { Request, Response, NextFunction } from 'express';
import { estadoLigaService } from './service';
import { createSchema, updateSchema } from './validator';
import { ok, created, noContent } from '../../utils/response';
import { ValidationError } from '../../utils/errors';

export const estadoLigaController = {
  async list(_req: Request, res: Response, next: NextFunction) {
    try { ok(res, await estadoLigaService.list()); } catch (e) { next(e); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await estadoLigaService.getById(req.params.id)); } catch (e) { next(e); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try { const p = createSchema.safeParse(req.body); if (!p.success) throw new ValidationError(p.error.issues[0].message); created(res, await estadoLigaService.create(p.data), 'Estado de liga creado exitosamente'); } catch (e) { next(e); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try { const p = updateSchema.safeParse(req.body); if (!p.success) throw new ValidationError(p.error.issues[0].message); ok(res, await estadoLigaService.update(req.params.id, p.data), 'Estado de liga actualizado exitosamente'); } catch (e) { next(e); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try { await estadoLigaService.delete(req.params.id); noContent(res); } catch (e) { next(e); }
  },
};
