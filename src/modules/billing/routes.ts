import { Router } from 'express';
import { requireAuth, requireRole } from '../../middlewares/authMiddleware';
import { billingSyncLimiter, destructiveOperationLimiter } from '../../middlewares/rateLimits';
import { billingController } from './controller';

const router = Router();

router.use(requireAuth);
router.get('/admin/operational-control', requireRole('ADMINISTRADOR'), billingController.operationalControl);
router.put(
  '/admin/operational-control',
  requireRole('ADMINISTRADOR'),
  destructiveOperationLimiter,
  billingController.updateOperationalControl,
);
router.get('/admin/migrations/summary', requireRole('ADMINISTRADOR'), billingController.migrationSummary);
router.get('/admin/migrations', requireRole('ADMINISTRADOR'), billingController.listMigrations);
router.get('/admin/migrations/:billingAccountId', requireRole('ADMINISTRADOR'), billingController.migration);
router.post(
  '/admin/migration-activation-reviews',
  requireRole('ADMINISTRADOR'),
  destructiveOperationLimiter,
  billingController.createMigrationActivationReview,
);
router.get(
  '/admin/migration-activation-reviews/:reviewId',
  requireRole('ADMINISTRADOR'),
  billingController.migrationActivationReview,
);
router.post(
  '/admin/migration-activation-reviews/:reviewId/approve',
  requireRole('ADMINISTRADOR'),
  destructiveOperationLimiter,
  billingController.approveMigrationActivationReview,
);
router.post(
  '/admin/migrations/:billingAccountId/activate',
  requireRole('ADMINISTRADOR'),
  destructiveOperationLimiter,
  billingController.activateMigration,
);
router.get('/admin/webhook-events', requireRole('ADMINISTRADOR'), billingController.listWebhookEvents);
router.get('/admin/webhook-events/:eventId', requireRole('ADMINISTRADOR'), billingController.webhookEvent);
router.post(
  '/admin/webhook-events/:eventId/replay',
  requireRole('ADMINISTRADOR'),
  destructiveOperationLimiter,
  billingController.replayWebhookEvent,
);
router.get('/state', billingController.state);
router.post('/bootstrap', requireRole('LIGA'), billingController.bootstrap);
router.get('/catalog', requireRole('LIGA'), billingController.catalog);
router.get('/purchase-selection', requireRole('LIGA'), billingController.purchaseSelection);
router.put('/migration-selection', requireRole('LIGA'), billingController.selectMigrationDivision);
router.put('/purchase-selection', requireRole('LIGA'), billingController.updatePurchaseSelection);
router.get('/checkout-attempts/active', requireRole('LIGA'), billingController.activeCheckout);
router.post('/checkout-attempts', requireRole('LIGA'), billingSyncLimiter, billingController.startCheckout);
router.post(
  '/checkout-attempts/:attemptId/outcome',
  requireRole('LIGA'),
  billingSyncLimiter,
  billingController.checkoutOutcome,
);
router.post('/sync', requireRole('LIGA'), billingSyncLimiter, billingController.sync);

export { router as billingRouter };
