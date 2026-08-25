import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createMany: vi.fn() }));

vi.mock('../../config/database', () => ({
  prisma: { waitlistEntry: { createMany: mocks.createMany } },
}));

import { waitlistRepository } from './repository';

describe('waitlistRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createMany.mockResolvedValue({ count: 1 });
  });

  it('uses one atomic skip-duplicates insert', async () => {
    const data = {
      email: 'Person@example.com',
      emailNormalized: 'person@example.com',
      role: 'CAPITAN' as const,
      source: 'LANDING_HERO' as const,
      consentAt: new Date('2026-08-25T12:00:00.000Z'),
      consentNoticeVersion: 'v1',
    };

    await expect(waitlistRepository.create(data)).resolves.toBeUndefined();

    expect(mocks.createMany).toHaveBeenCalledOnce();
    expect(mocks.createMany).toHaveBeenCalledWith({ data: [data], skipDuplicates: true });
  });

  it('does not reveal whether Prisma inserted or skipped the row', async () => {
    mocks.createMany.mockResolvedValue({ count: 0 });

    await expect(waitlistRepository.create({
      email: 'person@example.com',
      emailNormalized: 'person@example.com',
      consentAt: new Date(),
      consentNoticeVersion: 'v1',
    })).resolves.toBeUndefined();
  });
});
