import type { NextFunction, Request, Response } from 'express';
import { noContent, ok } from '../../utils/response';
import { ValidationError } from '../../utils/errors';
import { arbitrajeService } from './service';
import { asignacionesLigaSchema } from './validator';

const parse = <T>(schema: { safeParse(value: unknown): any }, value: unknown): T => { const result = schema.safeParse(value); if (!result.success) throw new ValidationError(result.error.issues[0].message); return result.data; };
const handle = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
export const arbitrajeController = {
  list: handle(async (req, res) => ok(res, await arbitrajeService.list(req.params.ligaId, req.user!))),
  detail: handle(async (req, res) => ok(res, await arbitrajeService.detail(req.params.ligaId, req.params.tandaId, req.user!))),
  candidates: handle(async (req, res) => ok(res, await arbitrajeService.candidates(req.params.ligaId, req.user!))),
  removeAssignment: handle(async (req, res) => { await arbitrajeService.removeAssignment(req.params.ligaId, req.params.asignacionId, req.user!); noContent(res); }),
  replaceLeagueAssignments: handle(async (req, res) => {
    const body = parse<{ asignacionId?: string; divisionIds: string[]; asignaciones: Array<{ partidoId: string; arbitroIds: string[] }> }>(asignacionesLigaSchema, req.body);
    ok(res, await arbitrajeService.replaceLeagueAssignments(req.params.ligaId, req.user!, body), 'Asignaciones de árbitros guardadas');
  }),
};
