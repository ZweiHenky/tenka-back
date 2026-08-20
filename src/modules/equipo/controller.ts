import { Request, Response, NextFunction } from 'express';
import { equipoService } from './service';
import { createSchema, updateSchema } from './validator';
import { ok, created, noContent } from '../../utils/response';
import { ValidationError } from '../../utils/errors';
import { getTeamCode } from '../../utils/teamCode';
import { parsePagination } from '../../utils/pagination';

function toTeamResponse(team: Awaited<ReturnType<typeof equipoService.getById>>, actorId?: string) {
  const { logoPublicId: _logoPublicId, nombreNormalizado: _nombreNormalizado, userId, ...publicTeam } = team;
  return { ...publicTeam, codigo: getTeamCode(team.id), esPropio: actorId === userId };
}

export const equipoController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.query;
      if (userId) {
        const data = await equipoService.listByUser(userId as string);
        ok(res, data.map((team) => toTeamResponse(team, req.user?.id)));
        return;
      }
      const result = await equipoService.listPaginated(parsePagination(req.query));
      ok(res, { ...result, rows: result.rows.map((team) => toTeamResponse(team, req.user?.id)) });
    } catch (e) { next(e); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try { ok(res, toTeamResponse(await equipoService.getById(req.params.id), req.user?.id)); } catch (e) { next(e); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const p = createSchema.safeParse({ ...req.body, userId: req.user!.id });
      if (!p.success) throw new ValidationError(p.error.issues[0].message);
      created(res, toTeamResponse(await equipoService.create(p.data), req.user!.id), 'Equipo creado exitosamente');
    } catch (e) { next(e); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try { const p = updateSchema.safeParse(req.body); if (!p.success) throw new ValidationError(p.error.issues[0].message); ok(res, toTeamResponse(await equipoService.update(req.params.id, p.data, req.user!), req.user!.id), 'Equipo actualizado exitosamente'); } catch (e) { next(e); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const confirmName = typeof req.body?.confirmName === 'string' && req.body.confirmName.trim() ? req.body.confirmName : undefined;
      await equipoService.delete(req.params.id, req.user!, confirmName);
      noContent(res);
    } catch (e) { next(e); }
  },
};
