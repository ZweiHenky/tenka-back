import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn((_req, _res, next) => next()),
  requireLeagueRole: vi.fn((_req, _res, next) => next()),
  requireAdminRole: vi.fn((_req, _res, next) => next()),
  destructiveOperationLimiter: vi.fn((_req, _res, next) => next()),
  state: vi.fn(),
  bootstrap: vi.fn(),
  catalog: vi.fn(),
  listWebhookEvents: vi.fn(),
  webhookEvent: vi.fn(),
  replayWebhookEvent: vi.fn(),
  operationalControl: vi.fn(),
  updateOperationalControl: vi.fn(),
  migrationSummary: vi.fn(),
  listMigrations: vi.fn(),
  migration: vi.fn(),
  createMigrationActivationReview: vi.fn(),
  migrationActivationReview: vi.fn(),
  approveMigrationActivationReview: vi.fn(),
  activateMigration: vi.fn(),
  selectMigrationDivision: vi.fn(),
  purchaseSelection: vi.fn(),
  updatePurchaseSelection: vi.fn(),
  activeCheckout: vi.fn(),
  startCheckout: vi.fn(),
  checkoutOutcome: vi.fn(),
  sync: vi.fn(),
  billingSyncLimiter: vi.fn((_req, _res, next) => next()),
}));

vi.mock('../../middlewares/authMiddleware', () => ({
  requireAuth: mocks.requireAuth,
  requireRole: vi.fn((role) => role === 'ADMINISTRADOR' ? mocks.requireAdminRole : mocks.requireLeagueRole),
}));
vi.mock('../../middlewares/rateLimits', () => ({
  destructiveOperationLimiter: mocks.destructiveOperationLimiter,
  billingSyncLimiter: mocks.billingSyncLimiter,
}));
vi.mock('./controller', () => ({
  billingController: {
    state: mocks.state,
    bootstrap: mocks.bootstrap,
    catalog: mocks.catalog,
    listWebhookEvents: mocks.listWebhookEvents,
    webhookEvent: mocks.webhookEvent,
    replayWebhookEvent: mocks.replayWebhookEvent,
    operationalControl: mocks.operationalControl,
    updateOperationalControl: mocks.updateOperationalControl,
    migrationSummary: mocks.migrationSummary,
    listMigrations: mocks.listMigrations,
    migration: mocks.migration,
    createMigrationActivationReview: mocks.createMigrationActivationReview,
    migrationActivationReview: mocks.migrationActivationReview,
    approveMigrationActivationReview: mocks.approveMigrationActivationReview,
    activateMigration: mocks.activateMigration,
    selectMigrationDivision: mocks.selectMigrationDivision,
    purchaseSelection: mocks.purchaseSelection,
    updatePurchaseSelection: mocks.updatePurchaseSelection,
    activeCheckout: mocks.activeCheckout,
    startCheckout: mocks.startCheckout,
    checkoutOutcome: mocks.checkoutOutcome,
    sync: mocks.sync,
  },
}));

import { billingRouter } from './routes';

describe('billing routes', () => {
  it('protects the router and mounts the state endpoint', () => {
    const authLayer = (billingRouter as any).stack.find((entry: any) => !entry.route);
    const stateLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/state' && entry.route?.methods?.get,
    );
    const catalogLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/catalog' && entry.route?.methods?.get,
    );
    const bootstrapLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/bootstrap' && entry.route?.methods?.post,
    );
    const queueLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/admin/webhook-events' && entry.route?.methods?.get,
    );
    const operationalControlLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/admin/operational-control' && entry.route?.methods?.get,
    );
    const updateOperationalControlLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/admin/operational-control' && entry.route?.methods?.put,
    );
    const replayLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/admin/webhook-events/:eventId/replay' && entry.route?.methods?.post,
    );
    const activateMigrationLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/admin/migrations/:billingAccountId/activate' && entry.route?.methods?.post,
    );
    const createMigrationReviewLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/admin/migration-activation-reviews' && entry.route?.methods?.post,
    );
    const migrationReviewLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/admin/migration-activation-reviews/:reviewId' && entry.route?.methods?.get,
    );
    const approveMigrationReviewLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/admin/migration-activation-reviews/:reviewId/approve' && entry.route?.methods?.post,
    );
    const migrationSummaryLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/admin/migrations/summary' && entry.route?.methods?.get,
    );
    const migrationsLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/admin/migrations' && entry.route?.methods?.get,
    );
    const migrationLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/admin/migrations/:billingAccountId' && entry.route?.methods?.get,
    );
    const migrationSelectionLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/migration-selection' && entry.route?.methods?.put,
    );
    const purchaseSelectionLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/purchase-selection' && entry.route?.methods?.get,
    );
    const updatePurchaseSelectionLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/purchase-selection' && entry.route?.methods?.put,
    );
    const startCheckoutLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/checkout-attempts' && entry.route?.methods?.post,
    );
    const activeCheckoutLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/checkout-attempts/active' && entry.route?.methods?.get,
    );
    const outcomeLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/checkout-attempts/:attemptId/outcome' && entry.route?.methods?.post,
    );
    const syncLayer = (billingRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/sync' && entry.route?.methods?.post,
    );

    expect(authLayer.handle).toBe(mocks.requireAuth);
    expect(stateLayer.route.stack.map((entry: any) => entry.handle)).toEqual([mocks.state]);
    expect(bootstrapLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireLeagueRole,
      mocks.bootstrap,
    ]);
    expect(catalogLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireLeagueRole,
      mocks.catalog,
    ]);
    expect(queueLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireAdminRole,
      mocks.listWebhookEvents,
    ]);
    expect(operationalControlLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireAdminRole,
      mocks.operationalControl,
    ]);
    expect(updateOperationalControlLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireAdminRole,
      mocks.destructiveOperationLimiter,
      mocks.updateOperationalControl,
    ]);
    expect(replayLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireAdminRole,
      mocks.destructiveOperationLimiter,
      mocks.replayWebhookEvent,
    ]);
    expect(activateMigrationLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireAdminRole,
      mocks.destructiveOperationLimiter,
      mocks.activateMigration,
    ]);
    expect(createMigrationReviewLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireAdminRole,
      mocks.destructiveOperationLimiter,
      mocks.createMigrationActivationReview,
    ]);
    expect(migrationReviewLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireAdminRole,
      mocks.migrationActivationReview,
    ]);
    expect(approveMigrationReviewLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireAdminRole,
      mocks.destructiveOperationLimiter,
      mocks.approveMigrationActivationReview,
    ]);
    expect(migrationSummaryLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireAdminRole,
      mocks.migrationSummary,
    ]);
    expect(migrationsLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireAdminRole,
      mocks.listMigrations,
    ]);
    expect(migrationLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireAdminRole,
      mocks.migration,
    ]);
    expect(migrationSelectionLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireLeagueRole,
      mocks.selectMigrationDivision,
    ]);
    expect(purchaseSelectionLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireLeagueRole,
      mocks.purchaseSelection,
    ]);
    expect(updatePurchaseSelectionLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireLeagueRole,
      mocks.updatePurchaseSelection,
    ]);
    expect(activeCheckoutLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireLeagueRole,
      mocks.activeCheckout,
    ]);
    expect(startCheckoutLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireLeagueRole,
      mocks.billingSyncLimiter,
      mocks.startCheckout,
    ]);
    expect(outcomeLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireLeagueRole,
      mocks.billingSyncLimiter,
      mocks.checkoutOutcome,
    ]);
    expect(syncLayer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.requireLeagueRole,
      mocks.billingSyncLimiter,
      mocks.sync,
    ]);
  });
});
