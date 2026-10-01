import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    APP_ENV: 'local',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    BILLING_PURCHASES_ENABLED: false,
    BILLING_REVENUECAT_ENABLED: false,
    BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED: false,
    BILLING_RESOURCE_ACCESS_SHADOW_ENABLED: false,
    BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED: false,
  },
}));

vi.mock('../../config/env', () => ({ env: mocks.env }));
vi.mock('../../config/database', () => ({ prisma: {} }));
vi.mock('../../config/logger', () => ({ logger: { warn: vi.fn() } }));

import {
  getAdminBillingOperationalControl,
  operationalControlInternals,
  resolvePurchasesEnabled,
  setAdminBillingOperationalControl,
} from './operationalControlService';

describe('billing operational control service', () => {
  beforeEach(() => {
    mocks.env.BILLING_PURCHASES_ENABLED = false;
    mocks.env.BILLING_REVENUECAT_ENABLED = false;
    mocks.env.BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED = false;
    mocks.env.BILLING_RESOURCE_ACCESS_SHADOW_ENABLED = false;
    mocks.env.BILLING_RESOURCE_ACCESS_ENFORCEMENT_ENABLED = false;
    vi.clearAllMocks();
  });

  it('audits administrative reads in the same transaction', async () => {
    const createAudit = vi.fn();
    const tx = {
      billingOperationalControl: { findUnique: vi.fn().mockResolvedValue({
        environment: 'PREVIEW', mode: 'PURCHASES_PAUSED', reason: 'Initial safe default',
        changedAt: new Date('2026-09-25T12:00:00Z'), version: 1,
      }) },
      billingAuditLog: { create: createAudit },
    };
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as never;

    await expect(getAdminBillingOperationalControl(
      { userId: 'admin-1', requestId: 'request-1' }, client,
    )).resolves.toMatchObject({ mode: 'PURCHASES_PAUSED', version: 1 });
    expect(createAudit).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'BILLING_OPERATIONAL_CONTROL_VIEWED', actorUserId: 'admin-1', targetId: 'PREVIEW',
    }) });
  });

  it('updates by expected version and persists an idempotent audit', async () => {
    const now = new Date('2026-09-25T13:00:00Z');
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const createAudit = vi.fn();
    const tx = {
      $queryRaw: vi.fn((strings: TemplateStringsArray) => Promise.resolve(
        strings.join('').includes('NOW()') ? [{ now }] : [],
      )),
      $executeRawUnsafe: vi.fn(),
      billingOperationalControl: {
        findUnique: vi.fn().mockResolvedValue({
          environment: 'PREVIEW', mode: 'PURCHASES_PAUSED', reason: 'Initial safe default',
          changedAt: new Date('2026-09-25T12:00:00Z'), version: 1,
        }),
        updateMany,
      },
      billingOperationalPause: { findFirst: vi.fn().mockResolvedValue(null) },
      billingAuditLog: { findFirst: vi.fn().mockResolvedValue(null), create: createAudit },
    };
    const client = { $transaction: vi.fn((callback) => callback(tx)) } as never;
    const input = {
      control: { mode: 'ENABLED' as const, reason: 'Enable controlled billing rollout', expectedVersion: 1 },
      idempotencyKey: 'control-change-1',
      actor: { userId: 'admin-1', requestId: 'request-1' },
    };

    await expect(setAdminBillingOperationalControl(input, client)).resolves.toEqual({
      environment: 'PREVIEW', mode: 'ENABLED', reason: input.control.reason, changedAt: now, version: 2,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { environment: 'PREVIEW', version: 1 },
      data: expect.objectContaining({ mode: 'ENABLED', version: 2, changedAt: now }),
    });
    expect(createAudit).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'BILLING_OPERATIONAL_CONTROL_CHANGED',
      idempotencyKey: 'control-change-1',
      requestFingerprint: operationalControlInternals.fingerprint('PREVIEW', input.control),
    }) });
  });

  it('requires every rollout layer and fails closed on control query errors', async () => {
    const findUnique = vi.fn().mockResolvedValue({ mode: 'ENABLED' });
    const client = { billingOperationalControl: { findUnique } } as never;
    await expect(resolvePurchasesEnabled('PREVIEW', true, client)).resolves.toBe(false);
    expect(findUnique).not.toHaveBeenCalled();

    mocks.env.BILLING_PURCHASES_ENABLED = true;
    mocks.env.BILLING_REVENUECAT_ENABLED = true;
    mocks.env.BILLING_EFFECTIVE_ACCESS_MATERIALIZATION_ENABLED = true;
    await expect(resolvePurchasesEnabled('PREVIEW', true, client)).resolves.toBe(false);

    mocks.env.BILLING_RESOURCE_ACCESS_SHADOW_ENABLED = true;
    await expect(resolvePurchasesEnabled('PREVIEW', true, client)).resolves.toBe(true);
    await expect(resolvePurchasesEnabled('PREVIEW', false, client)).resolves.toBe(false);

    findUnique.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(resolvePurchasesEnabled('PREVIEW', true, client)).resolves.toBe(false);
  });
});
