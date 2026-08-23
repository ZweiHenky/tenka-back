import { Request, Response, NextFunction } from 'express';
import { campeonService } from './service';
import { assignSchema } from './validator';
import { ok, noContent } from '../../utils/response';
import { ValidationError } from '../../utils/errors';
import { firstIssueMessage } from '../../utils/validation';

export const campeonController = {
  async findByDivision(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await campeonService.findByDivision(req.params.divisionId, req.user)); } catch (e) { next(e); }
  },

  async findByEquipo(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await campeonService.findByEquipo(req.params.equipoId, req.user)); } catch (e) { next(e); }
  },

  async findByJugador(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await campeonService.findByJugador(req.params.jugadorId, req.user)); } catch (e) { next(e); }
  },

  async findHistorialByDivision(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await campeonService.findHistorialByDivision(req.params.divisionId, req.user)); } catch (e) { next(e); }
  },

  async assign(req: Request, res: Response, next: NextFunction) {
    try { const p = assignSchema.safeParse(req.body); if (!p.success) throw new ValidationError(firstIssueMessage(p.error)); ok(res, await campeonService.assign(req.params.divisionId, p.data, req.user!), 'Campeón asignado exitosamente'); } catch (e) { next(e); }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try { await campeonService.remove(req.params.divisionId, req.user!); noContent(res); } catch (e) { next(e); }
  },
};
