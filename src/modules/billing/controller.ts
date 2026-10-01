import type { NextFunction, Request, Response } from 'express';
import type { ZodError } from 'zod';
import { ok } from '../../utils/response';
import { ValidationError } from '../../utils/errors';
import { firstIssueMessage } from '../../utils/validation';
import { bootstrapBillingAccount, getBillingState } from './service';
import { getActiveBillingCatalog } from './catalog';
import {
  getAdminBillingWebhookEvent,
  listAdminBillingWebhookEvents,
  replayAdminBillingWebhookEvent,
} from './adminWebhookService';
import {
  billingWebhookEventParamsSchema,
  billingWebhookIdempotencyKeySchema,
  billingWebhookListQuerySchema,
  billingWebhookReplayBodySchema,
} from './adminWebhookValidator';
import {
  billingAdminIdempotencyKeySchema,
  billingOperationalControlBodySchema,
} from './operationalControlValidator';
import {
  getAdminBillingOperationalControl,
  setAdminBillingOperationalControl,
} from './operationalControlService';
import { billingPurchaseSelectionBodySchema } from './purchaseSelectionValidator';
import { getBillingPurchaseSelection, putBillingPurchaseSelection } from './purchaseSelectionService';
import {
  billingCheckoutAttemptParamsSchema,
  billingCheckoutIdempotencyKeySchema,
  billingCheckoutOutcomeBodySchema,
  billingCheckoutStartBodySchema,
  billingSyncBodySchema,
} from './checkoutValidator';
import {
  getActiveBillingCheckout,
  reportBillingCheckoutOutcome,
  startBillingCheckout,
  syncBillingCheckout,
} from './checkoutService';
import {
  billingMigrationActivationParamsSchema,
  billingMigrationSelectionBodySchema,
} from './migrationLifecycleValidator';
import { activateBillingMigration, selectMigrationFreeDivision } from './migrationLifecycleService';
import {
  billingMigrationAdminListQuerySchema,
  billingMigrationAdminParamsSchema,
  billingMigrationAdminSummaryQuerySchema,
} from './adminMigrationValidator';
import {
  getAdminBillingMigration,
  getAdminBillingMigrationSummary,
  listAdminBillingMigrations,
} from './adminMigrationService';
import {
  billingMigrationActivationIdempotencyKeySchema,
  billingMigrationActivationReviewApprovalBodySchema,
  billingMigrationActivationReviewBodySchema,
  billingMigrationActivationReviewParamsSchema,
  billingMigrationReviewedActivationBodySchema,
} from './migrationActivationReviewValidator';
import {
  approveBillingMigrationActivationReview,
  createBillingMigrationActivationReview,
  getBillingMigrationActivationReview,
} from './migrationActivationReviewService';

function validated<T>(result: { success: true; data: T } | { success: false; error: ZodError }): T {
  if (!result.success) throw new ValidationError(firstIssueMessage(result.error));
  return result.data;
}

export const billingController = {
  async createMigrationActivationReview(req: Request, res: Response, next: NextFunction) {
    try {
      const review = validated(billingMigrationActivationReviewBodySchema.safeParse(req.body));
      const idempotencyKey = validated(billingMigrationActivationIdempotencyKeySchema.safeParse(req.get('Idempotency-Key')));
      const data = await createBillingMigrationActivationReview({
        review, idempotencyKey, actor: { userId: req.user!.id, requestId: req.requestId },
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async migrationActivationReview(req: Request, res: Response, next: NextFunction) {
    try {
      const { reviewId } = validated(billingMigrationActivationReviewParamsSchema.safeParse(req.params));
      ok(res, await getBillingMigrationActivationReview(reviewId, {
        userId: req.user!.id, requestId: req.requestId,
      }));
    } catch (error) {
      next(error);
    }
  },

  async approveMigrationActivationReview(req: Request, res: Response, next: NextFunction) {
    try {
      const { reviewId } = validated(billingMigrationActivationReviewParamsSchema.safeParse(req.params));
      const approval = validated(billingMigrationActivationReviewApprovalBodySchema.safeParse(req.body));
      const idempotencyKey = validated(billingMigrationActivationIdempotencyKeySchema.safeParse(req.get('Idempotency-Key')));
      ok(res, await approveBillingMigrationActivationReview({
        reviewId, approval, idempotencyKey,
        actor: { userId: req.user!.id, requestId: req.requestId },
      }));
    } catch (error) {
      next(error);
    }
  },

  async migrationSummary(req: Request, res: Response, next: NextFunction) {
    try {
      validated(billingMigrationAdminSummaryQuerySchema.safeParse(req.query));
      ok(res, await getAdminBillingMigrationSummary({
        userId: req.user!.id, requestId: req.requestId,
      }));
    } catch (error) {
      next(error);
    }
  },

  async listMigrations(req: Request, res: Response, next: NextFunction) {
    try {
      const query = validated(billingMigrationAdminListQuerySchema.safeParse(req.query));
      ok(res, await listAdminBillingMigrations(query, {
        userId: req.user!.id, requestId: req.requestId,
      }));
    } catch (error) {
      next(error);
    }
  },

  async migration(req: Request, res: Response, next: NextFunction) {
    try {
      const { billingAccountId } = validated(billingMigrationAdminParamsSchema.safeParse(req.params));
      ok(res, await getAdminBillingMigration(billingAccountId, {
        userId: req.user!.id, requestId: req.requestId,
      }));
    } catch (error) {
      next(error);
    }
  },

  async activateMigration(req: Request, res: Response, next: NextFunction) {
    try {
      const { billingAccountId } = validated(billingMigrationActivationParamsSchema.safeParse(req.params));
      const { reason, reviewId } = validated(billingMigrationReviewedActivationBodySchema.safeParse(req.body));
      const idempotencyKey = validated(billingMigrationActivationIdempotencyKeySchema.safeParse(req.get('Idempotency-Key')));
      ok(res, await activateBillingMigration({
        billingAccountId, reason, reviewId, idempotencyKey,
        actor: { userId: req.user!.id, requestId: req.requestId },
      }));
    } catch (error) {
      next(error);
    }
  },

  async selectMigrationDivision(req: Request, res: Response, next: NextFunction) {
    try {
      const { divisionId } = validated(billingMigrationSelectionBodySchema.safeParse(req.body));
      ok(res, await selectMigrationFreeDivision({
        userId: req.user!.id, divisionIdSnapshot: divisionId, requestId: req.requestId,
      }));
    } catch (error) {
      next(error);
    }
  },

  async operationalControl(req: Request, res: Response, next: NextFunction) {
    try {
      ok(res, await getAdminBillingOperationalControl({
        userId: req.user!.id,
        requestId: req.requestId,
      }));
    } catch (error) {
      next(error);
    }
  },

  async updateOperationalControl(req: Request, res: Response, next: NextFunction) {
    try {
      const control = validated(billingOperationalControlBodySchema.safeParse(req.body));
      const idempotencyKey = validated(billingAdminIdempotencyKeySchema.safeParse(req.get('Idempotency-Key')));
      ok(res, await setAdminBillingOperationalControl({
        control,
        idempotencyKey,
        actor: { userId: req.user!.id, requestId: req.requestId },
      }));
    } catch (error) {
      next(error);
    }
  },

  async state(req: Request, res: Response, next: NextFunction) {
    try {
      ok(res, await getBillingState(req.user!.id));
    } catch (error) {
      next(error);
    }
  },

  async bootstrap(req: Request, res: Response, next: NextFunction) {
    try {
      ok(res, await bootstrapBillingAccount(req.user!.id));
    } catch (error) {
      next(error);
    }
  },

  async catalog(_req: Request, res: Response, next: NextFunction) {
    try {
      ok(res, await getActiveBillingCatalog());
    } catch (error) {
      next(error);
    }
  },

  async purchaseSelection(req: Request, res: Response, next: NextFunction) {
    try {
      ok(res, await getBillingPurchaseSelection(req.user!.id));
    } catch (error) {
      next(error);
    }
  },

  async updatePurchaseSelection(req: Request, res: Response, next: NextFunction) {
    try {
      const selection = validated(billingPurchaseSelectionBodySchema.safeParse(req.body));
      ok(res, await putBillingPurchaseSelection({
        selection,
        actor: { userId: req.user!.id, requestId: req.requestId },
      }));
    } catch (error) {
      next(error);
    }
  },

  async activeCheckout(req: Request, res: Response, next: NextFunction) {
    try {
      ok(res, await getActiveBillingCheckout(req.user!.id));
    } catch (error) {
      next(error);
    }
  },

  async startCheckout(req: Request, res: Response, next: NextFunction) {
    try {
      const checkout = validated(billingCheckoutStartBodySchema.safeParse(req.body));
      const idempotencyKey = validated(billingCheckoutIdempotencyKeySchema.safeParse(req.get('Idempotency-Key')));
      ok(res, await startBillingCheckout({
        checkout, idempotencyKey,
        actor: { userId: req.user!.id, requestId: req.requestId },
      }));
    } catch (error) {
      next(error);
    }
  },

  async checkoutOutcome(req: Request, res: Response, next: NextFunction) {
    try {
      const { attemptId } = validated(billingCheckoutAttemptParamsSchema.safeParse(req.params));
      const outcome = validated(billingCheckoutOutcomeBodySchema.safeParse(req.body));
      const idempotencyKey = validated(billingCheckoutIdempotencyKeySchema.safeParse(req.get('Idempotency-Key')));
      const data = await reportBillingCheckoutOutcome({
        attemptId, outcome, idempotencyKey,
        actor: { userId: req.user!.id, requestId: req.requestId },
      });
      res.status(data.status === 'VERIFICATION_PENDING' || data.status === 'STORE_PENDING' ? 202 : 200)
        .json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async sync(req: Request, res: Response, next: NextFunction) {
    try {
      const input = validated(billingSyncBodySchema.safeParse(req.body));
      const data = await syncBillingCheckout({
        userId: req.user!.id, requestId: req.requestId,
        checkoutAttemptId: input.checkoutAttemptId,
      });
      res.status(data.status === 'PENDING' ? 202 : 200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listWebhookEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const query = validated(billingWebhookListQuerySchema.safeParse(req.query));
      ok(res, await listAdminBillingWebhookEvents(query, {
        userId: req.user!.id,
        requestId: req.requestId,
      }));
    } catch (error) {
      next(error);
    }
  },

  async webhookEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const { eventId } = validated(billingWebhookEventParamsSchema.safeParse(req.params));
      ok(res, await getAdminBillingWebhookEvent(eventId, {
        userId: req.user!.id,
        requestId: req.requestId,
      }));
    } catch (error) {
      next(error);
    }
  },

  async replayWebhookEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const { eventId } = validated(billingWebhookEventParamsSchema.safeParse(req.params));
      const { reason } = validated(billingWebhookReplayBodySchema.safeParse(req.body));
      const idempotencyKey = validated(billingWebhookIdempotencyKeySchema.safeParse(req.get('Idempotency-Key')));
      const data = await replayAdminBillingWebhookEvent({
        eventId,
        reason,
        idempotencyKey,
        actor: { userId: req.user!.id, requestId: req.requestId },
      });
      res.status(202).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
