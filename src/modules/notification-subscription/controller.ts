import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { notificationSubscriptionService } from './service';
import { noContent, created } from '../../utils/response';
import { ValidationError } from '../../utils/errors';

const id = z.string().trim().min(1).max(200);

const subscribeSchema = z.object({
  divisionId: id,
  oneSignalId: id,
  pushSubscriptionId: id,
});

const unsubscribeSchema = z.object({
  divisionId: id,
  pushSubscriptionId: id,
});

export const notificationSubscriptionSchemas = { subscribeSchema, unsubscribeSchema };

export const notificationSubscriptionController = {
  async subscribe(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = subscribeSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
      const sub = await notificationSubscriptionService.subscribe({ ...parsed.data, userId: req.user?.id ?? null });
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
