import { describe, expect, test } from 'vitest';
import { prisma } from '../../config/database';
import { getAdminBillingOperationalControl, setAdminBillingOperationalControl } from './operationalControlService';

describe('billing operational control', () => {
  test('serializes idempotent versioned changes and returns to the safe paused mode', async () => {
    const initial = await prisma.billingOperationalControl.findUniqueOrThrow({ where: { environment: 'PREVIEW' } });
    expect(initial).toMatchObject({ mode: 'PURCHASES_PAUSED' });

    const enableInput = {
      control: {
        mode: 'ENABLED' as const,
        reason: 'Enable controlled integration billing rollout',
        expectedVersion: initial.version,
      },
      idempotencyKey: 'integration-control-enable-1',
      actor: { userId: 'integration-admin', requestId: 'integration-request-enable' },
    };
    const [enabled, replayed] = await Promise.all([
      setAdminBillingOperationalControl(enableInput),
      setAdminBillingOperationalControl({
        ...enableInput,
        actor: { ...enableInput.actor, requestId: 'integration-request-enable-retry' },
      }),
    ]);
    expect(enabled).toEqual(replayed);
    expect(enabled).toMatchObject({ environment: 'PREVIEW', mode: 'ENABLED', version: initial.version + 1 });

    await expect(setAdminBillingOperationalControl({
      ...enableInput,
      control: { ...enableInput.control, mode: 'PURCHASES_PAUSED' },
    })).rejects.toThrow('Idempotency-Key ya fue utilizada');
    await expect(setAdminBillingOperationalControl({
      control: { ...enableInput.control, expectedVersion: initial.version },
      idempotencyKey: 'integration-control-stale-1',
      actor: { userId: 'integration-admin', requestId: 'integration-request-stale' },
    })).rejects.toThrow('vuelve a cargar');

    expect(await prisma.billingAuditLog.count({
      where: {
        action: 'BILLING_OPERATIONAL_CONTROL_CHANGED',
        targetId: 'PREVIEW',
        idempotencyKey: enableInput.idempotencyKey,
      },
    })).toBe(1);
    await expect(prisma.billingOperationalControl.update({
      where: { environment: 'PREVIEW' },
      data: { version: initial.version + 3 },
    })).rejects.toThrow();
    await expect(prisma.billingOperationalControl.delete({
      where: { environment: 'PREVIEW' },
    })).rejects.toThrow();

    const paused = await setAdminBillingOperationalControl({
      control: {
        mode: 'PURCHASES_PAUSED',
        reason: 'Restore safe state after integration verification',
        expectedVersion: initial.version + 1,
      },
      idempotencyKey: 'integration-control-pause-1',
      actor: { userId: 'integration-admin', requestId: 'integration-request-pause' },
    });
    expect(paused).toMatchObject({ mode: 'PURCHASES_PAUSED', version: initial.version + 2 });

    await expect(getAdminBillingOperationalControl({
      userId: 'integration-admin', requestId: 'integration-request-view',
    })).resolves.toMatchObject({ mode: 'PURCHASES_PAUSED', version: initial.version + 2 });
    expect(await prisma.billingAuditLog.count({
      where: { action: 'BILLING_OPERATIONAL_CONTROL_VIEWED', targetId: 'PREVIEW' },
    })).toBe(1);
  }, 30_000);
});
