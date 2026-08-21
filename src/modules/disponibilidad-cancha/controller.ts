import type { NextFunction, Request, Response } from 'express';
import { ValidationError } from '../../utils/errors';
import { ok } from '../../utils/response';
import { disponibilidadCanchaService } from './service';
import { availabilityRangeSchema } from './validator';
import { firstIssueMessage } from '../../utils/validation';

export const disponibilidadCanchaController = {
  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = availabilityRangeSchema.safeParse(req.query);
      if (!parsed.success) throw new ValidationError(firstIssueMessage(parsed.error));
      ok(res, await disponibilidadCanchaService.get(
        req.params.ligaId,
        parsed.data.inicio,
        parsed.data.fin,
        req.user!,
      ));
    } catch (error) {
      next(error);
    }
  },
};
