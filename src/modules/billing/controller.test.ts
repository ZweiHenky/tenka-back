import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bootstrapBillingAccount: vi.fn(),
  getBillingState: vi.fn(),
  getActiveBillingCatalog: vi.fn(),
  getAdminBillingOperationalControl: vi.fn(),
  setAdminBillingOperationalControl: vi.fn(),
  getBillingPurchaseSelection: vi.fn(),
  putBillingPurchaseSelection: vi.fn(),
  getActiveBillingCheckout: vi.fn(),
  abandonPreviewBillingCheckout: vi.fn(),
  reportBillingCheckoutOutcome: vi.fn(),
  startBillingCheckout: vi.fn(),
  syncBillingCheckout: vi.fn(),
  previewBillingChange: vi.fn(),
  confirmBillingChange: vi.fn(),
  confirmBillingChangeFinalStep: vi.fn(),
  abandonBillingChangeOperation: vi.fn(),
  activateBillingMigration: vi.fn(),
  selectMigrationFreeDivision: vi.fn(),
  createBillingMigrationActivationReview: vi.fn(),
  getBillingMigrationActivationReview: vi.fn(),
  approveBillingMigrationActivationReview: vi.fn(),
  getAdminBillingMigration: vi.fn(),
  getAdminBillingMigrationSummary: vi.fn(),
  listAdminBillingMigrations: vi.fn(),
}));

vi.mock('./service', () => ({
  bootstrapBillingAccount: mocks.bootstrapBillingAccount,
  getBillingState: mocks.getBillingState,
}));
vi.mock('./catalog', () => ({ getActiveBillingCatalog: mocks.getActiveBillingCatalog }));
vi.mock('./operationalControlService', () => ({
  getAdminBillingOperationalControl: mocks.getAdminBillingOperationalControl,
  setAdminBillingOperationalControl: mocks.setAdminBillingOperationalControl,
}));
vi.mock('./purchaseSelectionService', () => ({
  getBillingPurchaseSelection: mocks.getBillingPurchaseSelection,
  putBillingPurchaseSelection: mocks.putBillingPurchaseSelection,
}));
vi.mock('./checkoutService', () => ({
  getActiveBillingCheckout: mocks.getActiveBillingCheckout,
  abandonPreviewBillingCheckout: mocks.abandonPreviewBillingCheckout,
  reportBillingCheckoutOutcome: mocks.reportBillingCheckoutOutcome,
  startBillingCheckout: mocks.startBillingCheckout,
  syncBillingCheckout: mocks.syncBillingCheckout,
}));
vi.mock('./changePreviewService', () => ({
  previewBillingChange: mocks.previewBillingChange,
  confirmBillingChange: mocks.confirmBillingChange,
  confirmBillingChangeFinalStep: mocks.confirmBillingChangeFinalStep,
  abandonBillingChangeOperation: mocks.abandonBillingChangeOperation,
}));
vi.mock('./migrationLifecycleService', () => ({
  activateBillingMigration: mocks.activateBillingMigration,
  selectMigrationFreeDivision: mocks.selectMigrationFreeDivision,
}));
vi.mock('./migrationActivationReviewService', () => ({
  createBillingMigrationActivationReview: mocks.createBillingMigrationActivationReview,
  getBillingMigrationActivationReview: mocks.getBillingMigrationActivationReview,
  approveBillingMigrationActivationReview: mocks.approveBillingMigrationActivationReview,
}));
vi.mock('./adminMigrationService', () => ({
  getAdminBillingMigration: mocks.getAdminBillingMigration,
  getAdminBillingMigrationSummary: mocks.getAdminBillingMigrationSummary,
  listAdminBillingMigrations: mocks.listAdminBillingMigrations,
}));

import { billingController } from './controller';

describe('billingController migration activation review', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a review with normalized input, idempotency and administrator context', async () => {
    const review = { id: 'review-1', status: 'PENDING' };
    mocks.createBillingMigrationActivationReview.mockResolvedValue(review);
    const req = {
      user: { id: 'admin-1' }, requestId: 'request-1',
      body: {
        billingAccountIds: [' billing_account_1 ', 'billing_account_2'],
        reason: ' Review migration activation batch ',
      },
      get: vi.fn().mockReturnValue('review-create-1'),
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.createMigrationActivationReview(req, res, next);

    expect(mocks.createBillingMigrationActivationReview).toHaveBeenCalledWith({
      review: {
        billingAccountIds: ['billing_account_1', 'billing_account_2'],
        reason: 'Review migration activation batch',
      },
      idempotencyKey: 'review-create-1',
      actor: { userId: 'admin-1', requestId: 'request-1' },
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: review });
    expect(next).not.toHaveBeenCalled();
  });

  it('gets a normalized review id with administrator audit context', async () => {
    const review = { id: 'review-1', status: 'PENDING' };
    mocks.getBillingMigrationActivationReview.mockResolvedValue(review);
    const req = {
      user: { id: 'admin-1' }, requestId: 'request-2', params: { reviewId: ' review-1 ' },
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.migrationActivationReview(req, res, next);

    expect(mocks.getBillingMigrationActivationReview).toHaveBeenCalledWith('review-1', {
      userId: 'admin-1', requestId: 'request-2',
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: review });
    expect(next).not.toHaveBeenCalled();
  });

  it('approves a review with normalized input, idempotency and administrator context', async () => {
    const review = { id: 'review-1', status: 'APPROVED', version: 2 };
    mocks.approveBillingMigrationActivationReview.mockResolvedValue(review);
    const req = {
      user: { id: 'admin-1' }, requestId: 'request-3', params: { reviewId: ' review-1 ' },
      body: { expectedVersion: 1, reason: ' Approve reviewed migration batch ' },
      get: vi.fn().mockReturnValue('review-approve-1'),
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.approveMigrationActivationReview(req, res, next);

    expect(mocks.approveBillingMigrationActivationReview).toHaveBeenCalledWith({
      reviewId: 'review-1',
      approval: { expectedVersion: 1, reason: 'Approve reviewed migration batch' },
      idempotencyKey: 'review-approve-1',
      actor: { userId: 'admin-1', requestId: 'request-3' },
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: review });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('billingController migration inspection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards summary reads with the authenticated administrator audit context', async () => {
    const summary = { total: 4, activeLifecycleCount: 2 };
    mocks.getAdminBillingMigrationSummary.mockResolvedValue(summary);
    const req = {
      user: { id: 'admin-1' }, requestId: 'request-1', query: {},
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.migrationSummary(req, res, next);

    expect(mocks.getAdminBillingMigrationSummary).toHaveBeenCalledWith({
      userId: 'admin-1', requestId: 'request-1',
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: summary });
    expect(next).not.toHaveBeenCalled();
  });

  it('normalizes and forwards migration list filters and audit context', async () => {
    const result = { items: [{ id: 'migration-1' }], nextCursor: null };
    mocks.listAdminBillingMigrations.mockResolvedValue(result);
    const req = {
      user: { id: 'admin-1' },
      requestId: 'request-2',
      query: {
        status: ' SELECTED,PREPARED,SELECTED ',
        deadline: 'UPCOMING',
        cursor: ' migration-2 ',
        limit: '10',
      },
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.listMigrations(req, res, next);

    expect(mocks.listAdminBillingMigrations).toHaveBeenCalledWith({
      status: ['SELECTED', 'PREPARED'],
      deadline: 'UPCOMING',
      cursor: 'migration-2',
      limit: 10,
    }, { userId: 'admin-1', requestId: 'request-2' });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: result });
    expect(next).not.toHaveBeenCalled();
  });

  it('normalizes and forwards migration detail reads and audit context', async () => {
    const migration = { id: 'migration-1', billingAccountId: 'billing-1' };
    mocks.getAdminBillingMigration.mockResolvedValue(migration);
    const req = {
      user: { id: 'admin-1' }, requestId: 'request-3',
      params: { billingAccountId: ' billing-1 ' },
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.migration(req, res, next);

    expect(mocks.getAdminBillingMigration).toHaveBeenCalledWith(
      'billing-1',
      { userId: 'admin-1', requestId: 'request-3' },
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: migration });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects unknown summary filters before reading the summary', async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.migrationSummary({
      user: { id: 'admin-1' }, requestId: 'request-1', query: { status: 'PREPARED' },
    } as any, res, next);

    expect(mocks.getAdminBillingMigrationSummary).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });

  it('rejects invalid list filters before reading migrations', async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.listMigrations({
      user: { id: 'admin-1' }, requestId: 'request-1', query: { deadline: 'EXPIRED' },
    } as any, res, next);

    expect(mocks.listAdminBillingMigrations).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 422,
      message: expect.stringContaining('deadline'),
    }));
  });

  it('rejects an empty account id before reading migration detail', async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.migration({
      user: { id: 'admin-1' }, requestId: 'request-1', params: { billingAccountId: ' ' },
    } as any, res, next);

    expect(mocks.getAdminBillingMigration).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 422,
      message: expect.stringContaining('billingAccountId'),
    }));
  });
});

describe('billingController migration lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates and activates a billing migration as the authenticated administrator', async () => {
    const migration = { id: 'migration-1', status: 'SELECTION_REQUIRED' };
    mocks.activateBillingMigration.mockResolvedValue(migration);
    const req = {
      user: { id: 'admin-1' },
      requestId: 'request-1',
      params: { billingAccountId: ' billing-1 ' },
      body: { reviewId: ' review-1 ', reason: ' Approve legacy account migration ' },
      get: vi.fn().mockReturnValue('migration-activate-1'),
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.activateMigration(req, res, next);

    expect(mocks.activateBillingMigration).toHaveBeenCalledWith({
      billingAccountId: 'billing-1',
      reason: 'Approve legacy account migration',
      reviewId: 'review-1',
      idempotencyKey: 'migration-activate-1',
      actor: { userId: 'admin-1', requestId: 'request-1' },
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: migration });
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'an empty billing account id',
      params: { billingAccountId: ' ' },
      body: { reviewId: 'review-1', reason: 'Approve legacy account migration' },
      field: 'billingAccountId',
    },
    {
      name: 'a short activation reason',
      params: { billingAccountId: 'billing-1' },
      body: { reviewId: 'review-1', reason: 'too short' },
      field: 'reason',
    },
    {
      name: 'a missing review id',
      params: { billingAccountId: 'billing-1' },
      body: { reason: 'Approve legacy account migration' },
      field: 'reviewId',
    },
  ])('rejects $name before activating', async ({ params, body, field }) => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.activateMigration({
      user: { id: 'admin-1' }, requestId: 'request-1', params, body,
      get: vi.fn().mockReturnValue('migration-activate-1'),
    } as any, res, next);

    expect(mocks.activateBillingMigration).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 422,
      message: expect.stringContaining(field),
    }));
  });

  it('requires an Idempotency-Key before activating', async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.activateMigration({
      user: { id: 'admin-1' }, requestId: 'request-1',
      params: { billingAccountId: 'billing-1' },
      body: { reviewId: 'review-1', reason: 'Approve legacy account migration' },
      get: vi.fn().mockReturnValue(undefined),
    } as any, res, next);

    expect(mocks.activateBillingMigration).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });

  it('validates and selects a captured division for the authenticated league user', async () => {
    const migration = { id: 'migration-1', status: 'SELECTED' };
    mocks.selectMigrationFreeDivision.mockResolvedValue(migration);
    const req = {
      user: { id: 'league-1' },
      requestId: 'request-2',
      body: { divisionId: ' division-1 ' },
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.selectMigrationDivision(req, res, next);

    expect(mocks.selectMigrationFreeDivision).toHaveBeenCalledWith({
      userId: 'league-1',
      divisionIdSnapshot: 'division-1',
      requestId: 'request-2',
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: migration });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an empty migration division before selecting it', async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.selectMigrationDivision({
      user: { id: 'league-1' }, requestId: 'request-2', body: { divisionId: ' ' },
    } as any, res, next);

    expect(mocks.selectMigrationFreeDivision).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 422,
      message: expect.stringContaining('divisionId'),
    }));
  });
});

describe('billingController.state', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns billing state only for the authenticated identity', async () => {
    const state = {
      role: 'LIGA',
      effectiveAccess: 'FREE',
      billingAccountId: 'billing-1',
      revenueCatAppUserId: 'billing-1',
      effectiveCapacity: 1,
      limits: { teams: 40, leagues: 1, divisions: 1 },
      freeManagementGrant: null,
      purchasesEnabled: false,
    };
    mocks.getBillingState.mockResolvedValue(state);
    const req = { user: { id: 'session-user' }, query: { userId: 'other-user' } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.state(req, res, next);

    expect(mocks.getBillingState).toHaveBeenCalledWith('session-user');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: state });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards resolver errors', async () => {
    const error = new Error('resolver failed');
    mocks.getBillingState.mockRejectedValue(error);
    const next = vi.fn();

    await billingController.state({ user: { id: 'user-1' } } as any, {} as any, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('billingController.bootstrap', () => {
  beforeEach(() => vi.clearAllMocks());

  it('bootstraps only the authenticated identity and returns its billing state', async () => {
    const state = {
      role: 'LIGA',
      billingAccountId: 'billing-1',
      revenueCatAppUserId: 'billing-1',
      purchasesEnabled: false,
    };
    mocks.bootstrapBillingAccount.mockResolvedValue(state);
    const req = { user: { id: 'session-user' }, body: { userId: 'other-user' } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.bootstrap(req, res, next);

    expect(mocks.bootstrapBillingAccount).toHaveBeenCalledWith('session-user');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: state });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards bootstrap errors', async () => {
    const error = new Error('bootstrap failed');
    mocks.bootstrapBillingAccount.mockRejectedValue(error);
    const next = vi.fn();

    await billingController.bootstrap({ user: { id: 'user-1' } } as any, {} as any, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('billingController.catalog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only the server catalog projection', async () => {
    const catalog = { available: false, environment: 'PREVIEW', release: null, purchasesEnabled: false };
    mocks.getActiveBillingCatalog.mockResolvedValue(catalog);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.catalog({} as any, res, next);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: catalog });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('billingController operational control', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the current operational control for an administrator', async () => {
    const control = { environment: 'PREVIEW', mode: 'PURCHASES_PAUSED', version: 1 };
    mocks.getAdminBillingOperationalControl.mockResolvedValue(control);
    const req = { user: { id: 'admin-1' }, requestId: 'request-1' } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.operationalControl(req, res, next);

    expect(mocks.getAdminBillingOperationalControl).toHaveBeenCalledWith({
      userId: 'admin-1', requestId: 'request-1',
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: control });
  });

  it('validates and applies an idempotent control change', async () => {
    const control = { environment: 'PREVIEW', mode: 'ENABLED', version: 2 };
    mocks.setAdminBillingOperationalControl.mockResolvedValue(control);
    const req = {
      user: { id: 'admin-1' }, requestId: 'request-1',
      body: { mode: 'ENABLED', reason: 'Enable controlled billing rollout', expectedVersion: 1 },
      get: vi.fn().mockReturnValue('control-change-1'),
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.updateOperationalControl(req, res, next);

    expect(mocks.setAdminBillingOperationalControl).toHaveBeenCalledWith({
      control: req.body,
      idempotencyKey: 'control-change-1',
      actor: { userId: 'admin-1', requestId: 'request-1' },
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: control });
  });
});

describe('billingController purchase selection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads selection only for the authenticated identity', async () => {
    mocks.getBillingPurchaseSelection.mockResolvedValue(null);
    const req = { user: { id: 'session-user' }, query: { userId: 'other-user' } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.purchaseSelection(req, res, next);

    expect(mocks.getBillingPurchaseSelection).toHaveBeenCalledWith('session-user');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: null });
  });

  it('validates and writes a draft for the authenticated identity', async () => {
    const selection = { id: 'selection-1', version: 1 };
    mocks.putBillingPurchaseSelection.mockResolvedValue(selection);
    const req = {
      user: { id: 'session-user' }, requestId: 'request-1',
      body: {
        logicalProductId: 'tenka_capacity_3', billingInterval: 'MONTHLY',
        divisionIds: ['division-1'], expectedVersion: 0,
      },
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.updatePurchaseSelection(req, res, next);

    expect(mocks.putBillingPurchaseSelection).toHaveBeenCalledWith({
      selection: req.body,
      actor: { userId: 'session-user', requestId: 'request-1' },
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: selection });
  });
});

describe('billingController change operations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('previews a normalized target without creating commercial intent', async () => {
    const preview = { eligible: true, timing: 'TWO_STEP' };
    mocks.previewBillingChange.mockResolvedValue(preview);
    const req = {
      user: { id: 'user-1' }, requestId: 'request-1',
      body: { logicalProductId: ' tenka_capacity_6 ', billingInterval: 'ANNUAL' },
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.changePreview(req, res, next);

    expect(mocks.previewBillingChange).toHaveBeenCalledWith({
      change: { logicalProductId: 'tenka_capacity_6', billingInterval: 'ANNUAL' },
      actor: { userId: 'user-1', requestId: 'request-1' },
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: preview });
    expect(next).not.toHaveBeenCalled();
  });

  it('abandons a normalized operation with user and idempotency context', async () => {
    const operation = { id: 'operation-1', status: 'ABANDONED', version: 6 };
    mocks.abandonBillingChangeOperation.mockResolvedValue(operation);
    const req = {
      user: { id: 'user-1' }, requestId: 'request-2', params: { operationId: ' operation-1 ' },
      get: vi.fn().mockReturnValue('change-abandon-1'),
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.abandonChangeOperation(req, res, next);

    expect(mocks.abandonBillingChangeOperation).toHaveBeenCalledWith({
      operation: { operationId: 'operation-1' },
      idempotencyKey: 'change-abandon-1',
      actor: { userId: 'user-1', requestId: 'request-2' },
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: operation });
    expect(next).not.toHaveBeenCalled();
  });

  it('confirms the first and final steps with validated concurrency inputs', async () => {
    const result = { operation: { id: 'operation-1' }, attempt: { id: 'attempt-1' } };
    mocks.confirmBillingChange.mockResolvedValue(result);
    mocks.confirmBillingChangeFinalStep.mockResolvedValue(result);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();
    await billingController.confirmChangeOperation({
      user: { id: 'user-1' }, requestId: 'request-3', params: {},
      body: { targetVariantId: 'target-1', expectedSourceVariantId: 'source-1', previewFingerprint: 'a'.repeat(64) },
      get: vi.fn().mockReturnValue('change-confirm-1'),
    } as any, res, next);
    expect(mocks.confirmBillingChange).toHaveBeenCalledWith({
      confirm: { targetVariantId: 'target-1', expectedSourceVariantId: 'source-1', previewFingerprint: 'a'.repeat(64) },
      idempotencyKey: 'change-confirm-1', actor: { userId: 'user-1', requestId: 'request-3' },
    });
    await billingController.confirmChangeOperationFinalStep({
      user: { id: 'user-1' }, requestId: 'request-4', params: { operationId: ' operation-1 ' },
      body: { expectedVersion: 4 }, get: vi.fn().mockReturnValue('change-final-1'),
    } as any, res, next);
    expect(mocks.confirmBillingChangeFinalStep).toHaveBeenCalledWith({
      operation: { operationId: 'operation-1' }, confirm: { expectedVersion: 4 },
      idempotencyKey: 'change-final-1', actor: { userId: 'user-1', requestId: 'request-4' },
    });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('billingController checkout abandonment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards a validated owner request and returns accepted while evidence is pending', async () => {
    const result = { status: 'PENDING', reason: 'settlement_window', attempt: { id: 'attempt-1' } };
    mocks.abandonPreviewBillingCheckout.mockResolvedValue(result);
    const req = {
      user: { id: 'league-1' }, requestId: 'request-1', params: { attemptId: ' attempt-1 ' },
      body: { expectedVersion: 3 }, get: vi.fn().mockReturnValue('abandon-checkout-1'),
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.abandonCheckout(req, res, next);

    expect(mocks.abandonPreviewBillingCheckout).toHaveBeenCalledWith({
      attemptId: 'attempt-1', abandon: { expectedVersion: 3 }, idempotencyKey: 'abandon-checkout-1',
      actor: { userId: 'league-1', requestId: 'request-1' },
    });
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: result });
  });

  it('rejects an invalid version before calling the service', async () => {
    const req = {
      user: { id: 'league-1' }, requestId: 'request-1', params: { attemptId: 'attempt-1' },
      body: { expectedVersion: 0 }, get: vi.fn().mockReturnValue('abandon-checkout-1'),
    } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await billingController.abandonCheckout(req, res, next);

    expect(mocks.abandonPreviewBillingCheckout).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });
});
