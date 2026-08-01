import { Request, Response, NextFunction } from 'express';
import { rondaPlayoffService } from './service';
import { createSchema, generateSchema, updateSchema } from './validator';
import { ok, created, noContent } from '../../utils/response';
import { ValidationError } from '../../utils/errors';

export const rondaPlayoffController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await rondaPlayoffService.list(req.user)); } catch (e) { next(e); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await rondaPlayoffService.getById(req.params.id, req.user)); } catch (e) { next(e); }
  },

  async findByDivision(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await rondaPlayoffService.findByDivision(req.params.divisionId, req.user)); } catch (e) { next(e); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try { const p = createSchema.safeParse(req.body); if (!p.success) throw new ValidationError(p.error.issues[0].message); created(res, await rondaPlayoffService.create(p.data, req.user!), 'Ronda de playoff creada exitosamente'); } catch (e) { next(e); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try { const p = updateSchema.safeParse(req.body); if (!p.success) throw new ValidationError(p.error.issues[0].message); ok(res, await rondaPlayoffService.update(req.params.id, p.data, req.user!), 'Ronda de playoff actualizada exitosamente'); } catch (e) { next(e); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try { await rondaPlayoffService.delete(req.params.id, req.user!); noContent(res); } catch (e) { next(e); }
  },

  async deleteByDivision(req: Request, res: Response, next: NextFunction) {
    try { await rondaPlayoffService.deleteByDivision(req.params.divisionId, req.user!); noContent(res); } catch (e) { next(e); }
  },

  async generate(req: Request, res: Response, next: NextFunction) {
    try {
      const p = generateSchema.safeParse(req.body);
      if (!p.success) throw new ValidationError(p.error.issues[0].message);
      const rondas = await rondaPlayoffService.generate(p.data.divisionId, p.data.cantidadEquipos, req.user!);
      created(res, rondas, 'Llaves generadas exitosamente');
    } catch (e) { next(e); }
  },
};
