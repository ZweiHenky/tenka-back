import { Request, Response, NextFunction } from 'express';
import { divisionService } from './service';
import { createDivisionSchema, updateDivisionSchema } from './validator';
import { ok, created, noContent } from '../../utils/response';
import { ValidationError } from '../../utils/errors';

export const divisionController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const divisions = await divisionService.list(req.user);
      ok(res, divisions);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const division = await divisionService.getById(req.params.id, req.user);
      ok(res, division);
    } catch (err) {
      next(err);
    }
  },

  async listByLiga(req: Request, res: Response, next: NextFunction) {
    try {
      ok(res, await divisionService.listByLiga(req.params.ligaId, req.user));
    } catch (e) {
      next(e);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = createDivisionSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
      const division = await divisionService.create({
        ...parsed.data,
        fechaInicio: parsed.data.fechaInicio ? new Date(parsed.data.fechaInicio) : undefined,
        fechaFin: parsed.data.fechaFin ? new Date(parsed.data.fechaFin) : undefined,
      }, req.user!);
      created(res, division, 'Division creada exitosamente');
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = updateDivisionSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
      const division = await divisionService.update(req.params.id, {
        ...parsed.data,
        fechaInicio: parsed.data.fechaInicio ? new Date(parsed.data.fechaInicio) : undefined,
        fechaFin: parsed.data.fechaFin ? new Date(parsed.data.fechaFin) : undefined,
      }, req.user!);
      ok(res, division, 'Division actualizada exitosamente');
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await divisionService.delete(req.params.id, req.user!);
      noContent(res);
    } catch (err) {
      next(err);
    }
  },

  async reset(req: Request, res: Response, next: NextFunction) {
    try {
      await divisionService.resetDivision(req.params.id, req.user!);
      ok(res, undefined, 'Liga reiniciada exitosamente');
    } catch (err) {
      next(err);
    }
  },
};
