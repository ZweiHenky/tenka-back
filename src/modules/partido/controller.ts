import { Request, Response, NextFunction } from 'express';
import { partidoService } from './service';
import { createSchema, updateSchema } from './validator';
import { ok, created, noContent } from '../../utils/response';
import { ValidationError } from '../../utils/errors';
import { refereeAccessService } from '../referee-access/service';

export const partidoController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await partidoService.list(req.user)); } catch (e) { next(e); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await partidoService.getById(req.params.id, req.user)); } catch (e) { next(e); }
  },

  async findByJornada(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await partidoService.findByJornada(req.params.jornadaId, req.user)); } catch (e) { next(e); }
  },

  async findByRondaPlayoff(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await partidoService.findByRondaPlayoff(req.params.rondaPlayoffId, req.user)); } catch (e) { next(e); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try { const p = createSchema.safeParse(req.body); if (!p.success) throw new ValidationError(p.error.issues[0].message); created(res, await partidoService.create(p.data, req.user!), 'Partido creado exitosamente'); } catch (e) { next(e); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const p = updateSchema.safeParse(req.body);
      if (!p.success) throw new ValidationError(p.error.issues[0].message);
      const updated = await partidoService.update(req.params.id, p.data, req.user!);
      ok(res, updated, 'Partido actualizado exitosamente');
    } catch (e) { next(e); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try { await partidoService.delete(req.params.id, req.user!); noContent(res); } catch (e) { next(e); }
  },

  async getRefereeLinkStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const status = await refereeAccessService.getLinkStatus(req.params.id, req.user!);
      ok(res, status);
    } catch (e) { next(e); }
  },
};
