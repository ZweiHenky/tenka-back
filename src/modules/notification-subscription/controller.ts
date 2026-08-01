import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { notificationSubscriptionService } from './service';
import { noContent, created } from '../../utils/response';
import { ValidationError } from '../../utils/errors';

const subscribeSchema = z.object({
  divisionId: z.string(),
  oneSignalId: z.string(),
  pushSubscriptionId: z.string().optional().nullable(),
});

const unsubscribeSchema = z.object({
  divisionId: z.string(),
  oneSignalId: z.string(),
});

export const notificationSubscriptionController = {
  async subscribe(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = subscribeSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
      const sub = await notificationSubscriptionService.subscribe(parsed.data);
      created(res, sub);
    } catch (err) {
      next(err);
    }
  },

  async unsubscribe(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = unsubscribeSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
      await notificationSubscriptionService.unsubscribe(parsed.data);
      noContent(res);
    } catch (err) {
      next(err);
    }
  },
};
