import { Request, Response, NextFunction } from 'express';
import { jornadaService } from './service';
import { createSchema, updateSchema } from './validator';
import { ok, created, noContent } from '../../utils/response';
import { ValidationError } from '../../utils/errors';

export const jornadaController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await jornadaService.list(req.user)); } catch (e) { next(e); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await jornadaService.getById(req.params.id, req.user)); } catch (e) { next(e); }
  },

  async findByDivision(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
      const skip = (page - 1) * limit;
      ok(res, await jornadaService.findByDivision(req.params.divisionId, { skip, take: limit }, req.user));
    } catch (e) { next(e); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try { const p = createSchema.safeParse(req.body); if (!p.success) throw new ValidationError(p.error.issues[0].message); created(res, await jornadaService.create(p.data, req.user!), 'Jornada creada exitosamente'); } catch (e) { next(e); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try { const p = updateSchema.safeParse(req.body); if (!p.success) throw new ValidationError(p.error.issues[0].message); ok(res, await jornadaService.update(req.params.id, p.data, req.user!), 'Jornada actualizada exitosamente'); } catch (e) { next(e); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try { await jornadaService.delete(req.params.id, req.user!); noContent(res); } catch (e) { next(e); }
  },

  async generateNext(req: Request, res: Response, next: NextFunction) {
    try {
      const jornada = await jornadaService.generateNext(req.params.divisionId, req.user!, req.body.slots, req.body.equipoIds, req.body.descansoEquipoId);
      created(res, jornada, 'Jornada generada exitosamente');
    } catch (e) { next(e); }
  },
};
