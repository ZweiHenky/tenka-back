import { Request, Response, NextFunction } from 'express';
import { jornadaService } from './service';
import { generateNextSchema, idempotencyKeySchema } from './validator';
import { ok, created, noContent } from '../../utils/response';
import { ValidationError } from '../../utils/errors';
import { parsePagination } from '../../utils/pagination';

export const jornadaController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await jornadaService.list(parsePagination(req.query), req.user)); } catch (e) { next(e); }
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

  async delete(req: Request, res: Response, next: NextFunction) {
    try { await jornadaService.delete(req.params.id, req.user!); noContent(res); } catch (e) { next(e); }
  },

  async generateNext(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = generateNextSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
      const parsedKey = idempotencyKeySchema.safeParse(req.get('Idempotency-Key'));
      if (!parsedKey.success) throw new ValidationError(parsedKey.error.issues[0].message);
      const jornada = await jornadaService.generateNext(req.params.divisionId, req.user!, parsed.data.slots, parsed.data.equipoIds, parsed.data.descansoEquipoId, parsedKey.data);
      const { idempotencyReplayed, ...response } = jornada;
      if (idempotencyReplayed) ok(res, response, 'Jornada generada previamente');
      else created(res, response, 'Jornada generada exitosamente');
    } catch (e) { next(e); }
  },
};
