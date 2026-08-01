import { Request, Response, NextFunction } from 'express';
import { categoriaService } from './service';
import { createCategoriaSchema, updateCategoriaSchema } from './validator';
import { ok, created, noContent } from '../../utils/response';
import { ValidationError } from '../../utils/errors';

export const categoriaController = {
  async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const categorias = await categoriaService.list();
      ok(res, categorias);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const categoria = await categoriaService.getById(req.params.id);
      ok(res, categoria);
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = createCategoriaSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
      const categoria = await categoriaService.create(parsed.data);
      created(res, categoria, 'Categoría creada exitosamente');
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = updateCategoriaSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
      const categoria = await categoriaService.update(req.params.id, parsed.data);
      ok(res, categoria, 'Categoría actualizada exitosamente');
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await categoriaService.delete(req.params.id);
      noContent(res);
    } catch (err) {
      next(err);
    }
  },
};
