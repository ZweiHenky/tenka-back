import { Request, Response, NextFunction } from 'express';
import { partidoService } from './service';
import { createInJornadaSchema, createSchema, resultSchema, updateSchema } from './validator';
import { ok, created, noContent } from '../../utils/response';
import { ValidationError } from '../../utils/errors';
import { refereeAccessService } from '../referee-access/service';
import { parsePagination } from '../../utils/pagination';
import { jornadaPartidoCreationService } from './jornadaCreation';
import { firstIssueMessage } from '../../utils/validation';

export const partidoController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await partidoService.listPaginated(parsePagination(req.query), req.user)); } catch (e) { next(e); }
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

  async getJornadaCreationOptions(req: Request, res: Response, next: NextFunction) {
    try { ok(res, await jornadaPartidoCreationService.getOptions(req.params.jornadaId, req.user!)); } catch (e) { next(e); }
  },

  async createInJornada(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = createInJornadaSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(firstIssueMessage(parsed.error));
      const key = req.header('Idempotency-Key') ?? '';
      created(res, await jornadaPartidoCreationService.create(req.params.jornadaId, parsed.data, key, req.user!), 'Partido agregado a la jornada');
    } catch (e) { next(e); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try { const p = createSchema.safeParse(req.body); if (!p.success) throw new ValidationError(firstIssueMessage(p.error)); created(res, await partidoService.create(p.data, req.user!), 'Partido creado exitosamente'); } catch (e) { next(e); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const p = updateSchema.safeParse(req.body);
      if (!p.success) throw new ValidationError(firstIssueMessage(p.error));
      if (['golesLocal', 'golesVisitante', 'penalesLocal', 'penalesVisitante'].some((field) => p.data[field as keyof typeof p.data] !== undefined)
        || p.data.estado !== undefined) {
        throw new ValidationError('Usa PATCH /api/partidos/:id/resultado para modificar el resultado');
      }
      const updated = await partidoService.update(req.params.id, p.data, req.user!);
      ok(res, updated, 'Partido actualizado exitosamente');
    } catch (e) { next(e); }
  },

  async updateResult(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = resultSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(firstIssueMessage(parsed.error));
      ok(res, await partidoService.updateResult(req.params.id, parsed.data, req.user!), 'Resultado actualizado exitosamente');
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
