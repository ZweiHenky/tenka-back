import { Request, Response, NextFunction } from 'express';
import { equipoService } from './service';
import { createSchema, updateSchema } from './validator';
import { ok, created, noContent } from '../../utils/response';
import { ValidationError } from '../../utils/errors';

export const equipoController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.query;
      const data = userId ? await equipoService.listByUser(userId as string) : await equipoService.list();
      ok(res, data);
    } catch (e) { next(e); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await equipoService.getById(req.params.id)); } catch (e) { next(e); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const p = createSchema.safeParse({ ...req.body, userId: req.user!.id });
      if (!p.success) throw new ValidationError(p.error.issues[0].message);
      created(res, await equipoService.create(p.data), 'Equipo creado exitosamente');
    } catch (e) { next(e); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try { const p = updateSchema.safeParse(req.body); if (!p.success) throw new ValidationError(p.error.issues[0].message); ok(res, await equipoService.update(req.params.id, p.data, req.user!), 'Equipo actualizado exitosamente'); } catch (e) { next(e); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try { await equipoService.delete(req.params.id, req.user!); noContent(res); } catch (e) { next(e); }
  },
};
