import { Request, Response, NextFunction } from 'express';
import { tipoService } from './service';
import { createTipoSchema, updateTipoSchema } from './validator';
import { ok, created, noContent } from '../../utils/response';
import { ValidationError } from '../../utils/errors';
export const tipoController = {
  async list(_req: Request, res: Response, next: NextFunction) { try { ok(res, await tipoService.list()); } catch (e) { next(e); } },
  async getById(req: Request, res: Response, next: NextFunction) { try { ok(res, await tipoService.getById(req.params.id)); } catch (e) { next(e); } },
  async create(req: Request, res: Response, next: NextFunction) {
    try { const parsed = createTipoSchema.safeParse(req.body); if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message); created(res, await tipoService.create(parsed.data), 'Tipo creado exitosamente'); } catch (e) { next(e); }
  },
  async update(req: Request, res: Response, next: NextFunction) {
    try { const parsed = updateTipoSchema.safeParse(req.body); if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message); ok(res, await tipoService.update(req.params.id, parsed.data), 'Tipo actualizado exitosamente'); } catch (e) { next(e); }
  },
  async delete(req: Request, res: Response, next: NextFunction) { try { await tipoService.delete(req.params.id); noContent(res); } catch (e) { next(e); } },
};
