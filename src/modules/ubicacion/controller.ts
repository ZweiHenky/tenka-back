import { Request, Response, NextFunction } from 'express';
import { ubicacionService } from './service';
import { createSchema, updateSchema, findOrCreateSchema } from './validator';
import { ok, created, noContent } from '../../utils/response';
import { ValidationError } from '../../utils/errors';

export const ubicacionController = {
  async list(_req: Request, res: Response, next: NextFunction) {
    try { ok(res, await ubicacionService.list()); } catch (e) { next(e); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await ubicacionService.getById(req.params.id)); } catch (e) { next(e); }
  },

  async findOrCreate(req: Request, res: Response, next: NextFunction) {
    try { const p = findOrCreateSchema.safeParse(req.body); if (!p.success) throw new ValidationError(p.error.issues[0].message); ok(res, await ubicacionService.findOrCreate(p.data)); } catch (e) { next(e); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try { const p = createSchema.safeParse(req.body); if (!p.success) throw new ValidationError(p.error.issues[0].message); created(res, await ubicacionService.create(p.data), 'Ubicación creada exitosamente'); } catch (e) { next(e); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try { const p = updateSchema.safeParse(req.body); if (!p.success) throw new ValidationError(p.error.issues[0].message); ok(res, await ubicacionService.update(req.params.id, p.data), 'Ubicación actualizada exitosamente'); } catch (e) { next(e); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try { await ubicacionService.delete(req.params.id); noContent(res); } catch (e) { next(e); }
  },
};
