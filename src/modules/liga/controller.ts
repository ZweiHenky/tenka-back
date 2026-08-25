import { Request, Response, NextFunction } from 'express';
import { ligaService } from './service';
import { createLigaSchema, updateLigaSchema, createCanchaSchema, updateCanchaSchema, createArbitroSchema, updateArbitroSchema } from './validator';
import { ok, created, noContent } from '../../utils/response';
import { ValidationError } from '../../utils/errors';
import { parsePagination } from '../../utils/pagination';
import { firstIssueMessage } from '../../utils/validation';

function publicLiga<T extends object>(liga: T): Omit<T, 'logoPublicId' | 'canchaPublicId'> {
  const { logoPublicId: _logo, canchaPublicId: _cover, ...safe } = liga as T & { logoPublicId?: unknown; canchaPublicId?: unknown };
  return safe;
}

export const ligaController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, page, limit, search, categoriaId, tipoId, estadoLigaId } = req.query;

      if (!userId) {
        const pagination = parsePagination(req.query);
        const result = await ligaService.listPaginated({
          page: pagination.page,
          limit: pagination.limit,
          search: search as string | undefined,
          categoriaId: categoriaId as string | undefined,
          tipoId: tipoId as string | undefined,
          estadoLigaId: estadoLigaId as string | undefined,
        });
        ok(res, { ...result, rows: result.rows.map(publicLiga) });
      } else {
        const ligas = await ligaService.listByUser(userId as string, req.user);
        ok(res, ligas.map(publicLiga));
      }
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const liga = await ligaService.getById(req.params.id, req.user);
      ok(res, publicLiga(liga));
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = createLigaSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(firstIssueMessage(parsed.error));
      const liga = await ligaService.create(parsed.data, req.user!);
      created(res, publicLiga(liga), 'Liga creada exitosamente');
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = updateLigaSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(firstIssueMessage(parsed.error));
      const liga = await ligaService.update(req.params.id, parsed.data, req.user!);
      ok(res, publicLiga(liga), 'Liga actualizada exitosamente');
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const confirmName = typeof req.body?.confirmName === 'string' && req.body.confirmName.trim() ? req.body.confirmName : undefined;
      await ligaService.delete(req.params.id, req.user!, confirmName);
      noContent(res);
    } catch (err) {
      next(err);
    }
  },

  async listCanchas(req: Request, res: Response, next: NextFunction) {
    try {
      const canchas = await ligaService.getCanchas(req.params.ligaId, req.user!);
      ok(res, canchas);
    } catch (err) {
      next(err);
    }
  },

  async createCancha(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = createCanchaSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(firstIssueMessage(parsed.error));
      const cancha = await ligaService.createCancha(req.params.ligaId, parsed.data, req.user!);
      created(res, cancha, 'Cancha creada exitosamente');
    } catch (err) {
      next(err);
    }
  },

  async updateCancha(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = updateCanchaSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(firstIssueMessage(parsed.error));
      const cancha = await ligaService.updateCancha(req.params.ligaId, req.params.canchaId, parsed.data, req.user!);
      ok(res, cancha, 'Cancha actualizada exitosamente');
    } catch (err) {
      next(err);
    }
  },

  async deleteCancha(req: Request, res: Response, next: NextFunction) {
    try {
      await ligaService.deleteCancha(req.params.ligaId, req.params.canchaId, req.user!);
      noContent(res);
    } catch (err) {
      next(err);
    }
  },

  async listArbitros(req: Request, res: Response, next: NextFunction) {
    try {
      const arbitros = await ligaService.getArbitros(req.params.ligaId, req.user!);
      ok(res, arbitros);
    } catch (err) {
      next(err);
    }
  },

  async getRecentSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      const schedule = await ligaService.getRecentSchedule(req.params.ligaId, req.user!);
      ok(res, schedule);
    } catch (err) {
      next(err);
    }
  },

  async createArbitro(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = createArbitroSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(firstIssueMessage(parsed.error));
      const arbitro = await ligaService.createArbitro(req.params.ligaId, parsed.data, req.user!);
      created(res, arbitro, 'Árbitro creado exitosamente');
    } catch (err) {
      next(err);
    }
  },

  async updateArbitro(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = updateArbitroSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(firstIssueMessage(parsed.error));
      const arbitro = await ligaService.updateArbitro(req.params.ligaId, req.params.arbitroId, parsed.data, req.user!);
      ok(res, arbitro, 'Árbitro actualizado exitosamente');
    } catch (err) {
      next(err);
    }
  },

  async deleteArbitro(req: Request, res: Response, next: NextFunction) {
    try {
      await ligaService.deleteArbitro(req.params.ligaId, req.params.arbitroId, req.user!);
      noContent(res);
    } catch (err) {
      next(err);
    }
  },
};
