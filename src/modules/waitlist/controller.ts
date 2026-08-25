import type { NextFunction, Request, Response } from 'express';
import { ValidationError } from '../../utils/errors';
import { ok } from '../../utils/response';
import { firstIssueMessage } from '../../utils/validation';
import { waitlistService } from './service';
import { createWaitlistSchema } from './validator';

export const WAITLIST_ACCEPTED_MESSAGE = 'Solicitud aceptada';

export const waitlistController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = createWaitlistSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(firstIssueMessage(parsed.error));
      await waitlistService.accept(parsed.data);
      ok(res, undefined, WAITLIST_ACCEPTED_MESSAGE);
    } catch (error) {
      next(error);
    }
  },
};
