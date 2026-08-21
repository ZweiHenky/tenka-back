import { Request, Response, NextFunction } from 'express';
import { divisionEquipoService } from './service';
import { createSchema, updateSchema } from './validator';
import { ok, created, noContent } from '../../utils/response';
import { ValidationError } from '../../utils/errors';
import { getTeamCode } from '../../utils/teamCode';
import { firstIssueMessage } from '../../utils/validation';

export const divisionEquipoController = {
  async findByDivision(req: Request, res: Response, next: NextFunction) {
    try {
      const links = await divisionEquipoService.findByDivision(req.params.divisionId, req.user);
      ok(res, links.map(({ equipo, ...link }) => ({
        ...link,
        ...(equipo ? {
          equipo: {
            id: equipo.id,
            nombre: equipo.nombre,
            logo: equipo.logo,
            codigo: getTeamCode(equipo.id),
            esPropio: req.user?.id === equipo.userId,
          },
        } : {}),
      })));
    } catch (e) { next(e); }
  },

  async findByEquipo(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await divisionEquipoService.findByEquipo(req.params.equipoId, req.user)); } catch (e) { next(e); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try { const p = createSchema.safeParse(req.body); if (!p.success) throw new ValidationError(firstIssueMessage(p.error)); created(res, await divisionEquipoService.create(p.data, req.user!), 'Equipo asignado a division exitosamente'); } catch (e) { next(e); }
  },

  async updateSaldoPendiente(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(firstIssueMessage(parsed.error));
      const result = await divisionEquipoService.updateSaldoPendiente(
        req.params.divisionId,
        req.params.equipoId,
        parsed.data.saldoPendiente,
        req.user!,
      );
      ok(res, result, 'Saldo pendiente actualizado');
    } catch (e) { next(e); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try { await divisionEquipoService.delete(req.params.divisionId, req.params.equipoId, req.user!); noContent(res); } catch (e) { next(e); }
  },
};
