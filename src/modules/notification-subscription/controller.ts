import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { notificationSubscriptionService } from './service';
import { noContent, created, ok } from '../../utils/response';
import { ValidationError } from '../../utils/errors';
import { firstIssueMessage } from '../../utils/validation';

const id = z.string().trim().min(1).max(200);

const subscribeSchema = z.object({
  divisionId: id,
  oneSignalId: id,
  pushSubscriptionId: id,
});

const unsubscribeSchema = z.object({
  divisionId: id,
  oneSignalId: id.optional(),
  pushSubscriptionId: id,
});

export const NOTIFICATION_SYNC_DIVISION_LIMIT = 100;

const syncSchema = z.object({
  oneSignalId: id,
  pushSubscriptionId: id,
  divisionIds: z.array(id).max(NOTIFICATION_SYNC_DIVISION_LIMIT),
});

export const notificationSubscriptionSchemas = { subscribeSchema, unsubscribeSchema, syncSchema };

export const notificationSubscriptionController = {
  async sync(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = syncSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(firstIssueMessage(parsed.error));
      const state = await notificationSubscriptionService.sync({ ...parsed.data, userId: req.user?.id ?? null });
      ok(res, state);
    } catch (err) {
      next(err);
    }
  },

  async subscribe(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = subscribeSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(firstIssueMessage(parsed.error));
      const sub = await notificationSubscriptionService.subscribe({ ...parsed.data, userId: req.user?.id ?? null });
      created(res, sub);
    } catch (err) {
      next(err);
    }
  },

  async unsubscribe(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = unsubscribeSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(firstIssueMessage(parsed.error));
      await notificationSubscriptionService.unsubscribe(parsed.data);
      noContent(res);
    } catch (err) {
      next(err);
    }
  },
};
